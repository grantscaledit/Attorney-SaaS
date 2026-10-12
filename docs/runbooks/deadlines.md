# Runbook: deadlines (Phase 4)

Every deadline LexDesk shows is advisory. Verify against the source document. The firm's calendar
is the system of record.

## Rule verification session (once per firm, with the pilot attorney)

This is the "deadline rule verification session" on the onboarding checklist (spec Section 13).

1. Sign in as the owner attorney and open Settings > Deadline rules. Provisioning loaded the
   product's seed rules; all of them say "Not verified". If a product update added rules, use
   "Load new product rules".
2. Holidays: add the US federal holidays for this year and next with the buttons, then add or
   remove days to match the agencies and courts the firm deals with. Rules that move a date off
   weekends also skip these days.
3. For each rule, open it and check against the source:
   - the offset (days, months or years, or the annual date);
   - whether weekends and holidays move the date;
   - the severity;
   - for notice rules, the notice and letter numbers the rule applies to, and whether the notice
     prints its own date (then the printed date is used and the rule only cross-checks it);
   - for the Tax Court rule, the "addressed outside the US" variant.
     Change anything that is wrong and save. Then enter the citation you checked, tick the
     attestation, and choose "Verify rule".
4. Switch off any rule the firm does not want. A switched-off rule computes nothing.
5. Repeat at least yearly, and whenever the law changes. Editing a rule clears its verification;
   dates already computed stay, marked "Rule changed; re-verify", until it is verified again.

## Daily use

- A matter's Deadlines section takes trigger events (notice date, assessment date, date of death,
  letters granted, entity formed...). Each event is checked against the verified rules for the
  matter type. Rules not yet verified are listed in red and the owner attorney gets a task.
- B3 records the notice date and the printed respond-by date of a triaged notice automatically.
  The deadline says "Not confirmed" until someone confirms the extracted fields.
- Add a manual deadline for anything the firm calculates itself. Keep client names out of deadline
  names: they appear in calendar feeds.
- Rule-computed dates cannot be moved or cancelled by hand. Correct or remove the trigger event, or
  mark the deadline done.
- Collections matters: add tolling days to the collection statute with the reason (the attorney
  decides what tolls it), and record the installment agreement to track each payment.
- The Deadlines panel (and the top bar) count open deadlines in the next 7, 30 and 90 days, past
  due ones, unacknowledged alerts and matters with no deadline, with a month calendar.

## Alerts (C2)

- Every morning (6:50 firm time) each open deadline gets an alert when it reaches 30, 14, 7, 3 or 1
  days out, or is due or past due. The owner of the deadline (or the matter's responsible
  attorney) is texted at 3 days, 1 day and on the day, on the phone set as their GHL contact
  (Users > intake profile). Texts need the two C2 templates approved in Settings > Message
  templates.
- Alerts in the last 3 days, or the last 7 for critical deadlines, are critical. If nobody
  acknowledges one within 4 hours, the hourly job gives each owner attorney an urgent task and a
  text. Acknowledge on the matter page.

## Calendar link (C6)

Each person can create a private link in Settings > Calendar link and subscribe to it from Google
Calendar (Other calendars > From URL) or Outlook (Add calendar > Subscribe from web). It lists open
deadlines they own or that sit on matters they are responsible for. The link is shown once; making
a new one turns the old one off. Calendar apps refresh on their own schedule, often hours.

## Weekly audit (C7)

Monday morning the owner attorney gets a task when there are open matters with no deadline,
deadlines with no owner, or dates changed in the last 7 days. The same lists are on the Deadlines
panel.

## Jobs

| Queue                | When                  | Does                                             |
| -------------------- | --------------------- | ------------------------------------------------ |
| `deadlines.daily`    | 6:50 firm time        | New product rules, C3 next year, C5 payments, C2 |
| `deadlines.escalate` | hourly at :15         | C2 escalation of unacknowledged critical alerts  |
| `deadlines.weekly`   | Monday 7:20 firm time | C7 audit                                         |

All three are single audited commands; rerunning one changes nothing that already happened.
