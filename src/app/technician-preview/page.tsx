"use client";

import { useState } from "react";
import styles from "./preview.module.css";

const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const initialHours = days.map(() => ({ enabled: false, start: "09:00", end: "17:00" }));
const jobs = [
  { id: "DEMO-101", date: "2026-10-19", time: "09:00–11:00", status: "Confirmed", service: "Bumper scratch repair", vehicle: "Demo hatchback", location: "Home · Glandore", detail: "Surface scratches on rear bumper. Customer has requested mobile service at home." },
  { id: "DEMO-102", date: "2026-10-19", time: "13:00–15:00", status: "Requested", service: "Exterior detail", vehicle: "Demo SUV", location: "Work · Edwardstown", detail: "Exterior wash and detail. Requested time is awaiting confirmation and does not reserve capacity." },
  { id: "DEMO-103", date: "2026-10-20", time: "10:00–12:00", status: "Cancellation requested", service: "Door scratch repair", vehicle: "Demo sedan", location: "Home · Adelaide", detail: "Keep this time reserved until cancellation is confirmed by operations." },
];

export default function TechnicianPreview() {
  const [date, setDate] = useState("2026-10-19");
  const [hours, setHours] = useState(initialHours);
  const [savedHours, setSavedHours] = useState(initialHours);
  const [daysOff, setDaysOff] = useState<string[]>([]);
  const [savedDaysOff, setSavedDaysOff] = useState<string[]>([]);
  const [exceptionDate, setExceptionDate] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [filter, setFilter] = useState("All");
  const dirty = JSON.stringify([hours, daysOff]) !== JSON.stringify([savedHours, savedDaysOff]);
  const invalid = hours.some(h => h.enabled && (!h.start || !h.end || minutes(h.end) - minutes(h.start) < 15));
  const dayJobs = jobs.filter(job => job.date === date && (filter === "All" || (filter === "Confirmed" ? job.status !== "Requested" : job.status === "Requested")));
  const detail = jobs.find(job => job.id === selected);
  const weekday = date ? (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7 : -1;
  const window = savedHours[weekday];
  const available = window?.enabled && !savedDaysOff.includes(date);
  function changeHours(index: number, patch: Partial<typeof hours[number]>) {
    setHours(current => current.map((h, i) => i === index ? { ...h, ...patch } : h));
    setMessage("");
  }
  return <main className={styles.shell}>
    <p className={styles.brand}>SKYCAR / TECHNICIAN</p>
    <h1 className={styles.title}>Your working day.</h1>
    <p>Availability and jobs · Australia/Adelaide</p>
    <aside className={styles.notice}>Demo preview — fictional jobs. Changes stay in this tab and reset on reload. No customer booking is changed.</aside>
    <div className={styles.columns}>
      <section className={styles.panel} aria-labelledby="calendar-title">
        <h2 id="calendar-title">Calendar & jobs</h2>
        <label className={styles.field}>View date<input type="date" value={date} onChange={e => { setDate(e.target.value); setSelected(null); }} /></label>
        <p className={styles.summary}>{!date ? "Choose a date." : available ? `Working hours: ${window.start}–${window.end}` : "No published working hours for this day."}</p>
        <p className={styles.muted}>Confirmed work remains booked when working hours change.</p>
        <label className={styles.field}>Show jobs<select value={filter} onChange={e => { setFilter(e.target.value); setSelected(null); }}><option>All</option><option>Confirmed</option><option>Requested</option></select></label>
        <div className={styles.jobs}>{dayJobs.length === 0 ? <p>No jobs in this view. Choose 19 or 20 October 2026 to explore the demo.</p> : dayJobs.map(job => <button className={styles.job} key={job.id} aria-pressed={selected === job.id} onClick={() => setSelected(job.id)}>
          <span className={styles.badge}>{job.status}</span><strong>{job.time} · {job.service}</strong><span>{job.vehicle} · {job.location}</span><span>View job details →</span>
        </button>)}</div>
        {detail && <article className={styles.detail} aria-label="Job details">
          <h3>{detail.service}</h3><p>{detail.id} · {detail.status}</p><p>{detail.date} · {detail.time} · Australia/Adelaide</p><p>{detail.location}</p><p>{detail.detail}</p>
          <p className={styles.muted}>Job updates will be connected after the booking commands are reviewed.</p><button onClick={() => setSelected(null)}>Close details</button>
        </article>}
      </section>
      <section className={styles.panel} aria-labelledby="availability-title">
        <h2 id="availability-title">Your availability</h2>
        <p className={styles.muted}>Set your usual hours, then add days off. All times are Adelaide local time. Start with the days you work.</p>
        <form onSubmit={e => { e.preventDefault(); if (invalid) return; setSavedHours(hours.map(h => ({ ...h }))); setSavedDaysOff([...daysOff]); setMessage("Demo availability saved for this tab. Existing jobs are unchanged."); }}>
          {days.map((day, index) => <fieldset className={styles.day} key={day}><legend>{day}</legend>
            <label><input type="checkbox" checked={hours[index].enabled} onChange={e => changeHours(index, { enabled: e.target.checked })} /> Available</label>
            {hours[index].enabled && <div className={styles.times}><label>From<input aria-label={`${day} start`} type="time" required value={hours[index].start} onChange={e => changeHours(index, { start: e.target.value })} /></label><label>Until<input aria-label={`${day} end`} type="time" required value={hours[index].end} onChange={e => changeHours(index, { end: e.target.value })} /></label></div>}
          </fieldset>)}
          <h3>Days off</h3><label className={styles.field}>Date off<input type="date" value={exceptionDate} onChange={e => setExceptionDate(e.target.value)} /></label>
          <button type="button" disabled={!exceptionDate || daysOff.includes(exceptionDate)} onClick={() => { setDaysOff([...daysOff, exceptionDate].sort()); setExceptionDate(""); setMessage(""); }}>Add day off</button>
          {daysOff.length === 0 ? <p className={styles.muted}>No days off added.</p> : <ul>{daysOff.map(day => <li key={day}>{day} <button type="button" aria-label={`Remove day off ${day}`} onClick={() => { setDaysOff(daysOff.filter(d => d !== day)); setMessage(""); }}>Remove</button></li>)}</ul>}
          {invalid && <p role="alert">Each working window must end at least 15 minutes after it starts, on the same day.</p>}
          <div className={styles.actions}><button className={styles.primary} disabled={!dirty || invalid}>Save demo availability</button><button type="button" disabled={!dirty} onClick={() => { setHours(savedHours.map(h => ({ ...h }))); setDaysOff([...savedDaysOff]); setMessage("Unsaved changes discarded."); }}>Discard changes</button></div>
          <p role="status">{dirty ? "You have unsaved changes." : message}</p>
        </form>
      </section>
    </div>
  </main>;
}

function minutes(value: string) { const [hour, minute] = value.split(":").map(Number); return hour * 60 + minute; }
