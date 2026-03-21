from crewai.tools import tool, BaseTool
from pydantic import BaseModel, Field
import requests
from icalendar import Calendar
from datetime import datetime
from dateutil import tz
import os
from dotenv import load_dotenv
from twilio.rest import Client

load_dotenv()


class _FetchArgs(BaseModel):
    dummy: str = Field(default="", description="Unused")


def _parse_dt(dt_obj):
    """Normalize ical datetime to naive datetime in Toronto timezone."""
    if not dt_obj or not hasattr(dt_obj, 'dt'):
        return None
    dt = dt_obj.dt
    if isinstance(dt, datetime):
        if dt.tzinfo:
            dt = dt.astimezone(tz.gettz("America/Toronto")).replace(tzinfo=None)
        return dt
    return None


class FetchCalendarDeadlinesTool(BaseTool):
    name: str = "fetch_calendar_deadlines"
    description: str = "Fetches and parses Centennial Luminate .ics feed. Returns structured JSON with classes (name, time, room), assignments (title, due date), and exams."
    args_schema: type[BaseModel] = _FetchArgs

    def _run(self, **kwargs) -> str:
        import json
        try:
            ics_url = os.getenv("ICS_URL")
            if not ics_url:
                return json.dumps({"error": "ICS_URL not found in .env file"})
            response = requests.get(ics_url, timeout=15)
            response.raise_for_status()
            cal = Calendar.from_ical(response.content)
            now = datetime.now(tz.tzlocal()).replace(tzinfo=None)
            today = now.date()

            classes_today = []
            assignments = []
            exams = []

            for event in cal.walk("VEVENT"):
                summary = str(event.get("summary", "No title")).strip()
                parts = summary.split(" -- ") if " -- " in summary else summary.split(" - ", 1)
                course = parts[0].strip() if parts else "Unknown Course"
                title = parts[1].strip() if len(parts) > 1 else summary
                location = str(event.get("location", "") or "").strip()
                room = location if location else "TBA"

                dtstart = _parse_dt(event.get("dtstart"))
                dtend = _parse_dt(event.get("dtend"))
                due_dt = _parse_dt(event.get("due"))

                is_exam = "exam" in summary.lower() or "final" in summary.lower()

                due = due_dt or (dtend if not dtstart else None)
                if due:
                    if due <= now:
                        continue
                    days_left = (due.date() - today).days
                    if days_left > 30:
                        continue
                    hrs_left = (due - now).total_seconds() / 3600
                    item = {
                        "course": course,
                        "title": title,
                        "due_date": due.strftime("%b %d, %Y"),
                        "due_time": due.strftime("%I:%M %p"),
                        "due_datetime": due.strftime("%b %d %I:%M %p"),
                        "days_left": days_left,
                        "urgent": hrs_left <= 24,
                    }
                    if is_exam:
                        exams.append(item)
                    else:
                        assignments.append(item)

                if dtstart and dtend and dtstart.date() == today and not due_dt:
                    start_str = dtstart.strftime("%I:%M %p").lstrip("0").replace(" 0", " ")
                    end_str = dtend.strftime("%I:%M %p").lstrip("0").replace(" 0", " ")
                    short_code = course.split("_")[0][:8] if "_" in course else course[:10]
                    display_name = f"{title} ({short_code})" if title != summary else course
                    classes_today.append({
                        "course": course,
                        "title": title,
                        "display_name": display_name,
                        "start_time": start_str,
                        "end_time": end_str,
                        "class_date": today.isoformat(),
                        "room": room,
                        "_sort": dtstart,
                    })

            assignments.sort(key=lambda x: (x["days_left"], x["due_datetime"]))
            exams.sort(key=lambda x: (x["days_left"], x["due_datetime"]))
            classes_today.sort(key=lambda x: x["_sort"])
            for c in classes_today:
                del c["_sort"]

            assignments_3d = [a for a in assignments if a["days_left"] <= 3][:15]
            exams_3d = [e for e in exams if e["days_left"] <= 3][:10]

            data = {
                "classes_today": classes_today,
                "assignments_due_soon": assignments_3d,
                "exams": exams_3d,
                "date": today.strftime("%A, %B %d, %Y"),
                "date_iso": today.isoformat(),
            }
            return json.dumps(data, indent=2)
        except Exception as e:
            return json.dumps({"error": str(e)})


fetch_calendar_deadlines = FetchCalendarDeadlinesTool()


def _parse_time_to_minutes(s: str) -> int:
    from datetime import datetime as dt
    try:
        t = dt.strptime(str(s).strip().replace(" ", ""), "%I:%M%p")
        return t.hour * 60 + t.minute
    except Exception:
        return 0


def _minutes_to_str(m: int) -> str:
    h, mn = divmod(m, 60)
    suf = "PM" if h >= 12 else "AM"
    if h > 12:
        h -= 12
    elif h == 0:
        h = 12
    return f"{h}:{mn:02d} {suf}"


@tool("plan_daily_tasks")
def plan_daily_tasks(structured_data: str) -> str:
    """Builds a structured daily plan from calendar data (pure Python, no LLM)."""
    import json
    try:
        data = json.loads(structured_data)
        if "error" in data:
            return data["error"]

        today_str = data.get("date", datetime.now().strftime("%A, %B %d, %Y"))
        today_iso = data.get("date_iso", datetime.now(tz.tzlocal()).date().isoformat())
        classes = [c for c in data.get("classes_today", []) if c.get("class_date", today_iso) == today_iso]
        assignments = data.get("assignments_due_soon", [])
        exams = data.get("exams", [])
        all_due = assignments + exams

        sorted_classes = sorted(
            classes,
            key=lambda c: _parse_time_to_minutes(c.get("start_time", "")) or 9999,
        ) if classes else []

        commute_mins = 120
        study_duration = 60

        if sorted_classes:
            first_start = _parse_time_to_minutes(sorted_classes[0].get("start_time", "")) or (10 * 60)
            last_end = _parse_time_to_minutes(sorted_classes[-1].get("end_time", "")) or (12 * 60)

            wake_up = max(first_start - commute_mins - 90, 6 * 60)

            depart_to_campus = first_start - commute_mins
            arrive_campus = first_start - 15
            depart_from_campus = last_end + 15
            arrive_home = depart_from_campus + commute_mins

            commute_to_campus = {
                "depart": _minutes_to_str(depart_to_campus),
                "arrive": _minutes_to_str(arrive_campus),
            }
            commute_home = {
                "depart": _minutes_to_str(depart_from_campus),
                "arrive": _minutes_to_str(arrive_home),
            }
        else:
            first_start = 0
            last_end = 0
            wake_up = 9 * 60
            depart_to_campus = None
            arrive_campus = None
            depart_from_campus = None
            arrive_home = None
            commute_to_campus = None
            commute_home = None

        slots = []
        if not sorted_classes:
            slots = [(10 * 60, 12 * 60), (13 * 60, 15 * 60), (19 * 60, 21 * 60)]
        else:
            pre_start = arrive_campus + 30
            pre_end = first_start - 15
            if pre_end - pre_start >= 45:
                slots.append((pre_start, pre_end))

            for i in range(len(sorted_classes) - 1):
                end_m = _parse_time_to_minutes(sorted_classes[i].get("end_time", ""))
                next_start = _parse_time_to_minutes(sorted_classes[i + 1].get("start_time", ""))
                if next_start - end_m >= 45:
                    slots.append((end_m + 15, next_start - 15))

            if depart_from_campus - last_end >= 45:
                slots.append((last_end + 15, depart_from_campus - 15))

            evening_start = arrive_home + 30
            evening_end = 21 * 60
            if evening_end - evening_start >= 30:
                slots.append((evening_start, evening_end))

        study_items = [
            {
                "course": a["course"],
                "title": a["title"],
                "urgent": bool(a.get("urgent", False)),
                "days_left": a.get("days_left", 99),
            }
            for a in all_due
        ]
        study_items.sort(key=lambda x: (not x["urgent"], x["days_left"]))

        study_blocks = []
        block_idx = 0
        for slot_start, slot_end in slots:
            available = slot_end - slot_start
            while block_idx < len(study_items) and available >= study_duration:
                item = study_items[block_idx]
                block_idx += 1
                study_blocks.append({
                    "start": _minutes_to_str(slot_start),
                    "end": _minutes_to_str(slot_start + study_duration),
                    "course": item["course"],
                    "title": item["title"],
                })
                slot_start += study_duration
                available -= study_duration

        if not all_due and not sorted_classes:
            study_blocks.append({
                "start": "10:00 AM",
                "end": "11:00 AM",
                "course": "General",
                "title": "Review notes / upcoming topics",
            })

        if all_due and not study_blocks and slots and all((end - start) < 30 for start, end in slots):
            for item in study_items[:3]:
                study_blocks.append({
                    "start": "",
                    "end": "",
                    "course": item["course"],
                    "title": item["title"],
                })

        structured_plan = {
            "date": today_str,
            "wake_up": _minutes_to_str(wake_up),
            "commute_to_campus": commute_to_campus,
            "commute_home": commute_home,
            "classes": [
                {
                    "start_time": c.get("start_time", ""),
                    "display_name": c.get("display_name", c.get("title", c.get("course", "?"))),
                    "room": c.get("room", "TBA"),
                }
                for c in sorted_classes
            ],
            "due_soon": [
                {
                    "due_datetime": item.get("due_datetime", ""),
                    "course": item.get("course", "?"),
                    "title": item.get("title", "?"),
                    "urgent": bool(item.get("urgent", False)),
                }
                for item in all_due
            ],
            "study_blocks": study_blocks,
        }
        return json.dumps(structured_plan, indent=2)

    except json.JSONDecodeError as e:
        return f"Error parsing calendar data: {str(e)}"
    except Exception as e:
        return f"Error generating plan: {str(e)}"


@tool("format_plan")
def format_plan(structured_plan: str) -> str:
    """Formats structured plan JSON into WhatsApp-friendly message (pure Python)."""
    import json
    try:
        data = json.loads(structured_plan)
        if "error" in data:
            return data["error"]

        classes = data.get("classes", [])
        class_starts = [_parse_time_to_minutes(c.get("start_time", "")) for c in classes if _parse_time_to_minutes(c.get("start_time", "")) > 0]
        if not class_starts:
            start_label = "🌅 *Today*"
        elif any(t < 12 * 60 for t in class_starts):
            start_label = "☀️ *Morning*"
        else:
            start_label = "🌆 *Afternoon*"

        lines = [f"📅 *Plan for {data.get('date', '')}*", "", start_label]

        if data.get("wake_up"):
            lines.append(f"• {data.get('wake_up', '')} – Wake up")

        if data.get("commute_to_campus") is not None:
            lines.append(
                f"• {data.get('commute_to_campus', {}).get('depart', '')} – "
                f"{data.get('commute_to_campus', {}).get('arrive', '')} – *🚌 Commute to campus (2h)*"
            )

        lines.extend(["", "🏫 *CLASSES TODAY*"])
        if not classes:
            lines.append("• No classes today 🎉")
        else:
            for c in classes:
                lines.append(f"• {c.get('start_time', '')} – {c.get('display_name', '?')} 📍 Room {c.get('room', 'TBA')}")

        if data.get("commute_home") is not None:
            lines.extend([
                "",
                "🌆 *Evening*",
                f"• {data.get('commute_home', {}).get('depart', '')} – {data.get('commute_home', {}).get('arrive', '')} – *🚌 Commute home (2h)*",
            ])

        lines.extend(["", "📝 *DUE SOON*"])

        due_items = data.get("due_soon", [])
        if not due_items:
            lines.append("• Nothing due in next 3 days ✅")
        else:
            for item in due_items:
                urgent = " ⚠️ *URGENT*" if item.get("urgent") else ""
                lines.append(f"• 📌 {item.get('due_datetime', '')}: {item.get('course', '?')} – {item.get('title', '?')}{urgent}")

        lines.extend(["", "⏰ *STUDY BLOCKS*"])
        blocks = data.get("study_blocks", [])
        if not blocks:
            if due_items:
                first = due_items[0]
                lines.append(f"• Suggested: 2:00 PM – 3:00 PM → {first.get('course', '?')} – {first.get('title', '?')}")
            elif not classes:
                lines.append("• Suggested: 2:00 PM – 3:00 PM → Review notes / upcoming topics")
            else:
                lines.append("• No study blocks needed today")
        else:
            for block in blocks:
                if block.get("start") and block.get("end"):
                    lines.append(f"• 📚 {block.get('start')} – {block.get('end')} → {block.get('course', '?')} – {block.get('title', '?')}")
                else:
                    lines.append(f"• 📚 {block.get('course', '?')} – {block.get('title', '?')} (fit in when you can)")

        lines.extend(["", "💪 *You got this!*"])
        # Avoid JSON-unsafe escaping in downstream LLM tool calls.
        return "\n".join(lines).replace("'", "’")
    except Exception as e:
        return f"Error formatting plan: {str(e)}"


@tool("send_whatsapp_plan")
def send_whatsapp_plan(plan_text: str) -> str:
    """Sends the daily study plan to Yaksh's WhatsApp via Twilio."""
    try:
        import json
        account_sid = os.getenv("TWILIO_ACCOUNT_SID")
        auth_token = os.getenv("TWILIO_AUTH_TOKEN")
        from_number = os.getenv("TWILIO_WHATSAPP_FROM")
        to_number = os.getenv("YOUR_WHATSAPP_TO")

        if not all([account_sid, auth_token, from_number, to_number]):
            return "Error: Missing Twilio credentials in .env"

        client = Client(account_sid, auth_token)

        # Some model tool-calls pass escaped unicode/newlines as raw text.
        # Normalize so WhatsApp receives real emojis and line breaks.
        normalized_text = plan_text
        if "\\u" in normalized_text or "\\n" in normalized_text:
            try:
                escaped = normalized_text.replace("\\", "\\\\").replace('"', '\\"')
                normalized_text = json.loads('"' + escaped + '"')
            except Exception:
                normalized_text = normalized_text.replace("\\n", "\n")
        
        message = client.messages.create(
            body=normalized_text,
            from_=from_number,
            to=to_number
        )
        
        return f"Plan sent successfully! SID: {message.sid}"
    
    except Exception as e:
        return f"Failed to send WhatsApp message: {str(e)}"



