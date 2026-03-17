from crewai.tools import tool
import requests
from icalendar import Calendar  
from datetime import datetime
from dateutil import tz
import os
from dotenv import load_dotenv
from twilio.rest import Client
from openai import OpenAI

load_dotenv()

@tool("fetch_calendar")
def fetch_calendar_deadlines()-> str:
    """Fetches and parses upcoming deadlines from your Centennial Luminate .ics calendar.
    Returns a clean list of assignments/projects/quizzes with days left."""
    ics_url = os.getenv("ICS_URL")
    response = requests.get(ics_url)
    response.raise_for_status()
    
    cal = Calendar.from_ical(response.content)
    now = datetime.now(tz.tzlocal()).replace(tzinfo=None)
    deadlines = []
    
    for event in cal.walk("VEVENT"):
        summary = str(event.get("summary", "No title"))
        due_dt = event.get("due") or event.get("dtstart") or event.get("dtend")
        if not due_dt:
            continue
        due = due_dt.dt
        if isinstance(due, datetime):
            due = due.replace(tzinfo=None) if not due.tzinfo else due.astimezone(tz.gettz("America/Toronto")).replace(tzinfo=None)
        
        if due <= now:
            continue
            
        days_left = (due.date() - now.date()).days
        if days_left > 30:  # only next month
            continue
            
        # Simple course guessing
        course = summary.split(" -- ")[0] if " -- " in summary else "Centennial Course"
        deadlines.append(f"- {summary} ({course}) — due {due.strftime('%b %d %I:%M %p')} ({days_left} days left)")
    
    return "\n".join(deadlines[:12]) if deadlines else "No upcoming deadlines in the next 30 days."





@tool("plan_dailuy_tasks")
def plan_daily_tasks(deadlines:str):
    """Takes the list of upcoming Luminate deadlines and creates a realistic daily timeline 
    for Yaksh, factoring in his 2-hour commute to Centennial College each way, in-person classes, 
    meals, breaks, and Toronto life. Returns a clean bullet-point schedule."""
    
    
    today = datetime.now().strftime("%A, %B %d, %Y")
    
    prompt = f"""You are Yaksh's personal Centennial College productivity coach in Toronto.

Today is {today}.
My commute: 2 hours to college + 2 hours back home (total 4 hours travel).
I attend in-person classes at Centennial (Luminate).

Upcoming deadlines:
{deadlines}

Create a **realistic TODAY-ONLY schedule** that fits everything:
- Wake up, breakfast, prep time
- Morning commute slot (assume leaving home ~7:00-8:00 AM)
- College time (classes + focused study blocks)
- Afternoon/evening commute back
- Evening study / assignments (only if urgent)
- Dinner, exercise, wind-down
- Max 5-7 hours focused work (respect commute fatigue)
- Use exact times (e.g. 07:30 AM)
- Prioritise anything due in 1-5 days first

Return ONLY the schedule in clean bullet points. End with one short motivational line."""
    
    client = OpenAI(
        api_key=os.getenv("XAI_API_KEY"),
        base_url="https://api.x.ai/v1"
    )
    
    response = client.chat.completions.create(
        model="grok-beta",          # or "grok-3" — whatever shows in your xAI console
        messages=[{"role": "user", "content": prompt}],
        max_tokens=700,
        temperature=0.65
    )
    
    return response.choices[0].message.content.strip()





@tool("send_whatsapp_plan")
def send_whatsapp_plan(plan_text:str)->str:
    """Sends the final daily study plan to Yaksh's WhatsApp using Twilio."""
    client = Client(os.getenv("TWILIO_ACCOUNT_SID"), os.getenv("TWILIO_AUTH_TOKEN"))
    message = client.messages.create(
        body=f"📅 Your Centennial Daily Plan\n\n{plan_text}\n\nCrush it today! 💪",
        from_=os.getenv("TWILIO_WHATSAPP_FROM"),
        to=os.getenv("YOUR_WHATSAPP_TO")
    )
    return f"✅ Plan sent successfully! Message SID: {message.sid}"




