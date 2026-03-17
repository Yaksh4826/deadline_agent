from crewai import Agent, Task, Crew, LLM
from dotenv import load_dotenv
import os
from tools import fetch_calendar_deadlines, plan_daily_tasks, send_whatsapp_plan
from datetime import datetime

load_dotenv()

groq_api_key = os.getenv("GROQ_API_KEY")
if not groq_api_key:
    raise ValueError("GROQ_API_KEY not found. Add it to your .env file. Get one at https://console.groq.com/keys")

llm = LLM(
    model="groq/llama-3.3-70b-versatile",
    api_key=groq_api_key,
    temperature=0.7,
)

study_agent = Agent(
    role="Centennial College Study Coach for Yaksh",
    goal="Fetch Yaksh's Luminate deadlines, create a commute-aware daily plan (4 hours total travel), and send it to his WhatsApp every morning.",
    backstory="""You are Yaksh's dedicated, realistic coach in Toronto. 
    Yaksh has a long 2-hour commute EACH WAY to Centennial College (total 4 hours travel daily).
    Always follow this exact sequence:
    1. Call fetch_calendar_deadlines to get current deadlines.
    2. Pass the deadlines string directly to plan_daily_tasks (it knows the commute details).
    3. Take the returned schedule and call send_whatsapp_plan to send it.
    Be practical: limit evening work, respect fatigue, add transit buffers.""",
    llm=llm,
    tools=[fetch_calendar_deadlines, plan_daily_tasks, send_whatsapp_plan],
    verbose=True,
    allow_delegation=False,
    memory=False
)

daily_task = Task(
    description="""Today is {current_date}.
Follow these steps exactly:
1. Use fetch_calendar_deadlines tool → get the deadlines string.
2. Feed that exact string into plan_daily_tasks tool (it will create a schedule that accounts for Yaksh's 2h commute each way / 4h total travel).
3. Take the schedule text returned by plan_daily_tasks and pass it to send_whatsapp_plan.
Return only a short confirmation once sent.""".format(current_date=datetime.now().strftime("%A, %B %d, %Y")),
    expected_output="Confirmation message like 'Plan sent to WhatsApp successfully'.",
    agent=study_agent
)

crew = Crew(agents=[study_agent], tasks=[daily_task], verbose=True)

if __name__ == "__main__":
    result = crew.kickoff()
    print(result)
