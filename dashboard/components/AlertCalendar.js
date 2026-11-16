import { ChevronLeft, ChevronRight } from "lucide-react";

import { daysInMonth, fmtDate, shiftMonth } from "@/lib/time";

import Panel from "./Panel";

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function dayClass(key, minutes, { date, today }) {
  const cls = ["day"];
  if (key === date) cls.push("selected");
  if (key > today) cls.push("future");
  else if (minutes == null) cls.push("nodata");
  else if (minutes === 0) cls.push("calm");
  else cls.push(minutes >= 30 ? "hot" : "warm");
  return cls.join(" ");
}

// Month view: red days had alerts, blue days stayed under the limit. Click a day to view it.
export default function AlertCalendar({ date, today, calendar = {}, onSelect }) {
  if (!date) return <Panel title="Calendar" />;
  const [y, m] = date.split("-").map(Number);
  const offset = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const days = Array.from({ length: daysInMonth(y, m) }, (_, i) => `${date.slice(0, 7)}-${String(i + 1).padStart(2, "0")}`);
  const atCurrentMonth = date.slice(0, 7) === today?.slice(0, 7);

  return (
    <Panel title={fmtDate(date, { month: "long", year: "numeric" })} className="calendar"
           actions={
             <>
               <button className="icon-btn" aria-label="Previous month"
                       onClick={() => onSelect(shiftMonth(date, -1, today))}><ChevronLeft size={16} /></button>
               <button className="icon-btn" aria-label="Next month" disabled={atCurrentMonth}
                       onClick={() => onSelect(shiftMonth(date, 1, today))}><ChevronRight size={16} /></button>
             </>
           }>
      <div className="cal-grid">
        {WEEKDAYS.map((d) => <span key={d} className="wd">{d}</span>)}
        {Array.from({ length: offset }, (_, i) => <span key={`pad${i}`} />)}
        {days.map((key) => (
          <button key={key} className={dayClass(key, calendar[key], { date, today })}
                  disabled={key > today} onClick={() => onSelect(key)}
                  title={calendar[key] ? `${calendar[key]} min over the limit` : undefined}>
            {Number(key.slice(8))}
          </button>
        ))}
      </div>
    </Panel>
  );
}
