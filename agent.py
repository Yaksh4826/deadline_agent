from crewai import Agent, Task, Crew, LLM
from dotenv import load_dotenv
import os
from tools import fetch_calendar_deadlines, plan_daily_tasks, format_plan, send_whatsapp_plan
from datetime import datetime

load_dotenv()

groq_api_key = os.getenv("GROQ_API_KEY")
if not groq_api_key:
    raise ValueError("GROQ_API_KEY not found. Add it to your .env file. Get one at https://console.groq.com/keys")

llm = LLM(
    model="groq/llama-3.3-70b-versatile",
    api_key=groq_api_key,
    temperature=0.0,
)

study_agent = Agent(
    role="Centennial College Study Coach for Yaksh",
    goal="Fetch Yaksh's Luminate deadlines, create a commute-aware daily plan (4 hours total travel), and send it to his WhatsApp every morning.",
    backstory="""You are Yaksh's dedicated coach in Toronto. 2-hour commute each way (4h total).
    Always follow deterministic tool-only flow:
    1) fetch_calendar_deadlines -> structured calendar JSON
    2) plan_daily_tasks with that JSON -> structured validated plan JSON
    3) format_plan with that structured plan JSON -> friendly WhatsApp text with emojis
    4) send_whatsapp_plan with the formatted text
    Do not invent classes/assignments; use only tool outputs.
    Never modify, escape, or replace * asterisk characters in tool outputs.
    Pass tool outputs exactly as returned without any reformatting.""",
    llm=llm,
    tools=[fetch_calendar_deadlines, plan_daily_tasks, format_plan, send_whatsapp_plan],
    verbose=True,
    allow_delegation=False,
    memory=False
)

daily_task = Task(
    description="""Today is {current_date}.
Follow these steps exactly:
1. Use fetch_calendar_deadlines tool → get structured JSON (classes, assignments, exams).
2. Pass that JSON into plan_daily_tasks tool → receive structured and validated plan JSON.
3. Pass the structured plan JSON into format_plan tool → receive friendly formatted message with emojis.
4. Pass that formatted message into send_whatsapp_plan.
Return only a short confirmation once sent.""".format(current_date=datetime.now().strftime("%A, %B %d, %Y")),
    expected_output="Confirmation message like 'Plan sent to WhatsApp successfully'.",
    agent=study_agent
)

crew = Crew(agents=[study_agent], tasks=[daily_task], verbose=True)

if __name__ == "__main__":
    result = crew.kickoff()
    print(result)
