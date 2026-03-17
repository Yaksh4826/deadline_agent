from crewai.tools import tool, BaseTool
from pydantic import BaseModel, Field
import requests
from icalendar import Calendar
from datetime import datetime
from dateutil import tz
import os
from dotenv import load_dotenv
from twilio.rest import Client
from google import genai
from google.genai import types

load_dotenv()


class _FetchArgs(BaseModel):
    dummy: str = Field(default="", description="Unused")


class FetchCalendarDeadlinesTool(BaseTool):
    name: str = "fetch_calendar_deadlines"
    description: str = "Fetches and parses upcoming deadlines from Centennial Luminate .ics feed. Returns a clean list of upcoming assignments/projects/quizzes with days left."
    args_schema: type[BaseModel] = _FetchArgs

    def _run(self, **kwargs) -> str:
        try:
            ics_url = os.getenv("ICS_URL")
            if not ics_url:
                return "Error: ICS_URL not found in .env file"
            response = requests.get(ics_url, timeout=15)
            response.raise_for_status()
            cal = Calendar.from_ical(response.content)
            now = datetime.now(tz.tzlocal()).replace(tzinfo=None)
            deadlines = []
            for event in cal.walk("VEVENT"):
                summary = str(event.get("summary", "No title")).strip()
                due_dt = event.get("due") or event.get("dtstart") or event.get("dtend")
                if not due_dt or not hasattr(due_dt, 'dt'):
                    continue
                due = due_dt.dt
                if isinstance(due, datetime):
                    if due.tzinfo:
                        due = due.astimezone(tz.gettz("America/Toronto")).replace(tzinfo=None)
                    else:
                        due = due
                if due <= now:
                    continue
                days_left = (due.date() - now.date()).days
                if days_left > 30:
                    continue
                course = summary.split(" -- ")[0].strip() if " -- " in summary else "Centennial Course"
                deadlines.append(f"- {summary} ({course}) — due {due.strftime('%b %d %I:%M %p')} ({days_left} days left)")
            if not deadlines:
                return "No upcoming deadlines in the next 30 days."
            return "\n".join(deadlines[:12])
        except Exception as e:
            return f"Error fetching calendar: {str(e)}"


fetch_calendar_deadlines = FetchCalendarDeadlinesTool()

@tool("plan_daily_tasks")
def plan_daily_tasks(deadlines: str) -> str:
    """Creates a realistic daily schedule for Yaksh taking into account his 2-hour commute each way (4h total travel)."""
    try:
        today = datetime.now().strftime("%A, %B %d, %Y")
        
        prompt = f"""You are Yaksh's realistic Centennial College coach in Toronto.

Today is {today}.
Commute: **2 hours each way** (total ~4 hours travel daily on class days) using TTC/GO — include 15–30 min buffer for delays.
Classes usually ~9 AM – 4–6 PM, but focus on fitting deadlines.

Upcoming deadlines:
{deadlines}

Rules for TODAY-ONLY schedule:
- Wake up 5:30–6:30 AM range
- Morning commute: leave ~6:30–7:30 AM → arrive 9–10 AM
- College time: short study blocks between classes
- Evening commute: leave ~4–7 PM → home 6–9 PM
- Evening study: only 1–2 hours max if very urgent (fatigue after travel)
- Include: meals, short walk/exercise, 10–15 min breaks, wind-down
- Max 5–6 hours focused work
- Prioritize 1–3 day deadlines
- Use exact times (e.g. 06:15 AM, 07:45–09:45 commute)
- End with one short motivational sentence

Return ONLY bullet points. No extra explanation."""

        # Gemini API (uses GEMINI_API_KEY or GOOGLE_API_KEY from .env)
        api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
        if not api_key:
            return "Error: GEMINI_API_KEY or GOOGLE_API_KEY not found in .env file"

        client = genai.Client(api_key=api_key)
        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt,
            config=types.GenerateContentConfig(
                temperature=0.65,
                max_output_tokens=750,
            ),
        )
        return response.text.strip() if response.text else "Error: No response from Gemini"
    
    except Exception as e:
        return f"Error generating plan: {str(e)}"
    
@tool("send_whatsapp_plan")
def send_whatsapp_plan(plan_text: str) -> str:
    """Sends the daily study plan to Yaksh's WhatsApp via Twilio."""
    try:
        account_sid = os.getenv("TWILIO_ACCOUNT_SID")
        auth_token = os.getenv("TWILIO_AUTH_TOKEN")
        from_number = os.getenv("TWILIO_WHATSAPP_FROM")
        to_number = os.getenv("YOUR_WHATSAPP_TO")

        if not all([account_sid, auth_token, from_number, to_number]):
            return "Error: Missing Twilio credentials in .env"

        client = Client(account_sid, auth_token)
        
        message = client.messages.create(
            body=f"📅 Centennial Daily Plan\n\n{plan_text}\n\nYou've got this! 💪",
            from_=from_number,
            to=to_number
        )
        
        return f"Plan sent successfully! SID: {message.sid}"
    
    except Exception as e:
        return f"Failed to send WhatsApp message: {str(e)}"



