from crewai import Agent, Task, Crew
from langchain_openai import ChatOpenAI  # works with any OpenAI-compatible API
from dotenv import load_dotenv
import os
from tools import fetch_luminate_deadlines, send_whatsapp_plan
from datetime import datetime
load_dotenv()

# 1. Connect Grok (xAI)
llm = ChatOpenAI(
    model="grok-beta",                    # or "grok-3" / check your console for latest
    base_url="https://api.x.ai/v1",
    api_key=os.getenv("XAI_API_KEY"),
    temperature=0.7
)

# 2. The Agent
study_agent = Agent(
    role="Centennial College Study Coach",
    goal="Create a realistic daily timeline plan based on Yaksh's Luminate deadlines and send it to his WhatsApp every morning.",
    backstory="""You are a helpful, motivating coach for Yaksh in Toronto. 
    You always fetch the latest deadlines first, build a practical schedule (4-7 hours work, breaks, meals, Toronto commute), 
    then send it via WhatsApp. Be encouraging but realistic.""",
    llm=llm,
    tools=[fetch_luminate_deadlines, send_whatsapp_plan],  # import from tools.py
    verbose=True,          # ← this shows you the agent's thinking!
    allow_delegation=False
)

# 3. The Task
daily_task = Task(
    description="""Today is {current_date}. 
    1. Use the fetch_luminate_deadlines tool to get current deadlines.
    2. Create a realistic TODAY-ONLY study plan (exact times, prioritize urgent items, include breaks/meals).
    3. Use the send_whatsapp_plan tool to message it to Yaksh.""".format(current_date=datetime.now().strftime("%A, %B %d, %Y")),
    expected_output="A short confirmation that the plan was sent to WhatsApp.",
    agent=study_agent
)

# 4. Run the Crew (single agent = simple crew)
crew = Crew(agents=[study_agent], tasks=[daily_task], verbose=2)

if __name__ == "__main__":
    result = crew.kickoff()
    print(result)