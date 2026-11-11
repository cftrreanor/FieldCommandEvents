// The emails the app sends on its own whose wording an admin can change
// (20261227000000_system_emails.sql). Each one's subject, heading, message and
// button text can be replaced from /admin/emails; links, times, calendar
// invites and the footer stay in the code. With nothing saved, the code's
// built-in wording goes out unchanged. Client-safe: the editor uses it too.

export type SystemEmailField = { key: string; label: string; sample: string };

export type SystemEmailText = {
  subject: string;
  heading: string;
  /** Paragraphs, separated by a blank line. */
  body: string;
  /** Blank: the built-in button text. */
  button_label: string | null;
};

export type SystemEmail = {
  key: string;
  group: string;
  name: string;
  /** Who gets it and when, in plain words. */
  description: string;
  fields: SystemEmailField[];
  /** Fields the email can't go out without (somewhere in the subject, heading or message). */
  required: string[];
  /** Fields that can't go in the subject (a child's name: our sent-email log keeps subjects). */
  private?: string[];
  /** The built-in wording, written with fields. */
  starting: SystemEmailText & { button_label: string | null };
  /** Lines the code always adds after the message (shown in the preview, not editable). */
  locked: string[];
};

const inviteFields: SystemEmailField[] = [
  { key: "inviter", label: "Who invited them (name and organization)", sample: "Jordan Lee from Lakeside HS Band Boosters" },
  { key: "organization", label: "Organization", sample: "Lakeside HS Band Boosters" },
  { key: "event_name", label: "Event name", sample: "Lakeside Marching Classic" },
  { key: "event_when", label: "Event dates and venue", sample: "Oct 24, 2026 at Lakeside Stadium" },
  { key: "event_day", label: "The big day (contest day or the event day)", sample: "contest day" },
];
const inviteLocked = [
  "Tap the button to accept. There's no password: it signs you in as {their email}, and sets up your account if you don't have one yet.",
];

const bookingFields: SystemEmailField[] = [
  { key: "who", label: "Family or person who booked", sample: "The Rivera family (Sam Rivera)" },
  { key: "when", label: "Meeting date and time", sample: "Tue, Nov 3, 4:10–4:25 PM" },
  { key: "kind", label: "conference or meeting", sample: "conference" },
  { key: "event_name", label: "Event name", sample: "Fall conferences" },
];

const familyFields: SystemEmailField[] = [
  { key: "first_name", label: "Their first name", sample: "Maria" },
  { key: "teacher", label: "Teacher or organizer", sample: "Ms. Ruiz" },
  { key: "kind", label: "conference or meeting", sample: "conference" },
  { key: "when", label: "Meeting date and time", sample: "Tue, Nov 3 · 4:10–4:25 PM" },
  { key: "event_name", label: "Event name", sample: "Fall conferences" },
  { key: "child", label: "Child's name (blank when not asked)", sample: "Ava" },
  { key: "about_child", label: "“about” and the child's name (blank when not asked)", sample: "about Ava" },
  { key: "for_child", label: "“for” and the child's name (blank when not asked)", sample: "for Ava" },
];
const childFields = ["child", "about_child", "for_child"];
const bookingRows = "Then: when, where, who's coming, and the privacy promise";
const calendarRemoved = "If you added our calendar invite, it will be removed from your calendar (in Gmail, you may need to open this email first).";
const organizerNote = "Your note, if you added one when you rescheduled or canceled";
const bookingDeleted = "Your booking details (their contact details, note, and any child's name) have been deleted.";

const visitFields: SystemEmailField[] = [
  { key: "first_name", label: "Their first name", sample: "Maria" },
  { key: "event_name", label: "Event name", sample: "Lakeside visitor day" },
  { key: "when", label: "Date and time", sample: "Nov 12, 2026, 9:00–11:00 AM" },
];
/** The photo ID line (lib/parents ID_REMINDER): always in school visit emails. */
const idReminder = "Bring a valid government-issued photo ID (driver's license, state ID, or passport). You won't be let in without it.";

const volunteerFields: SystemEmailField[] = [
  { key: "first_name", label: "Their first name", sample: "Sam" },
  { key: "event_name", label: "Event name", sample: "Lakeside Marching Classic" },
  { key: "at_venue", label: "“at” and the venue (blank when there's none)", sample: "at Lakeside Stadium" },
];
const shiftRows = "Then: each shift's sign-up, time, and where to report";

const directorFields: SystemEmailField[] = [
  { key: "band_name", label: "Band or group name", sample: "Lakeside HS Marching Band" },
  { key: "school", label: "School", sample: "Lakeside High School" },
  { key: "event_name", label: "Event name", sample: "Lakeside Marching Classic" },
];
const timeRows = "Then: their order, warm-up, ready position, performance time, and the venue";
const roomRows = "Then: each room and time, and the venue";

const fileFields: SystemEmailField[] = [
  { key: "file_name", label: "The file's name", sample: "Parking map" },
  { key: "a_change", label: "“a new” or “an updated”", sample: "a new" },
  { key: "change", label: "new or updated", sample: "new" },
  { key: "event_name", label: "Event name", sample: "Lakeside Marching Classic" },
  { key: "event_date", label: "Event date", sample: "Sat, Oct 24, 2026" },
];

export const SYSTEM_EMAILS: SystemEmail[] = [
  {
    key: "host_invitation",
    group: "Hosts",
    name: "Host invitation",
    description: "Goes to a new host when you invite them from the pipeline without picking an email template.",
    fields: [
      { key: "first_name", label: "Their first name", sample: "Jordan" },
      { key: "name", label: "Their full name", sample: "Jordan Lee" },
      { key: "email", label: "Their email address", sample: "jordan@example.com" },
      { key: "organization", label: "Organization", sample: "Lakeside HS Band Boosters" },
      { key: "plan", label: "Package and free period", sample: "Schedule Command (free pilot)" },
      { key: "free_until", label: "Last free day", sample: "Jan 1, 2027" },
    ],
    required: ["email"],
    starting: {
      subject: "Your {{brand}} host invitation",
      heading: "You're invited to host on {{brand}}",
      body: "Hi {{first_name}}. Your pilot spot is ready. Tap the button below to set up your account and create your first event.\n\nThere's no password to remember: the button signs you in as {{email}}. It works for 7 days. After that, sign in with this email address and we'll email you a sign-in link.",
      button_label: "Set up my account",
    },
    locked: [],
  },
  {
    key: "team_invite_cohost",
    group: "Team invitations",
    name: "Co-host invitation",
    description: "Goes to someone a host invites to co-host their events.",
    fields: [
      ...inviteFields,
      { key: "access", label: "What co-hosts can do", sample: "setting up and publishing events, sign-ups, volunteers, and the event day" },
    ],
    required: [],
    starting: {
      subject: "You're invited to co-host {{organization}} on {{brand}}",
      heading: "Co-host events for {{organization}}",
      body: "{{inviter}} invited you to co-host their events on {{brand}}.\n\nAs a co-host, you'll help run every event on the account: {{access}}. You'll have the same access as the Account Host, except inviting or removing co-hosts, or deleting events.",
      button_label: "Accept invitation",
    },
    locked: inviteLocked,
  },
  {
    key: "team_invite_event_cohost",
    group: "Team invitations",
    name: "Co-host invitation (one event)",
    description: "Goes to someone the Account Host invites to co-host one event.",
    fields: inviteFields,
    required: [],
    starting: {
      subject: "You're invited to co-host {{event_name}} on {{brand}}",
      heading: "Co-host {{event_name}}",
      body: "{{inviter}} invited you to co-host {{event_name}} ({{event_when}}) on {{brand}}.\n\nAs a co-host, you'll help run this event: setup, publishing, sign-ups, volunteers, and the event day. You can do everything the organizer can on it, except invite or remove co-hosts, or delete it. You won't see other events from {{organization}}, and your access ends 10 days after the event.",
      button_label: "Accept invitation",
    },
    locked: inviteLocked,
  },
  {
    key: "team_invite_volunteer_lead",
    group: "Team invitations",
    name: "Volunteer Lead invitation",
    description: "Goes to someone a host invites to help run volunteers for an event.",
    fields: inviteFields,
    required: [],
    starting: {
      subject: "Help run volunteers for {{event_name}}",
      heading: "You're invited to be a Volunteer Lead",
      body: "{{inviter}} invited you to help run volunteers for {{event_name}} ({{event_when}}).\n\nAs a Volunteer Lead you'll set up sign-ups and shifts, see who's signed up, check people in, and help run {{event_day}}.",
      button_label: "Accept invitation",
    },
    locked: inviteLocked,
  },
  {
    key: "team_invite_section_lead",
    group: "Team invitations",
    name: "Coordinator invitation",
    description: "Goes to someone a host asks to lead one sign-up.",
    fields: [
      ...inviteFields,
      { key: "station", label: "Their sign-up", sample: "Concessions" },
      { key: "lead_title", label: "Coordinator", sample: "Coordinator" },
    ],
    required: [],
    starting: {
      subject: "Lead {{station}} at {{event_name}}",
      heading: "You're invited to be a {{lead_title}}",
      body: "{{inviter}} asked you to lead {{station}} at {{event_name}} ({{event_when}}).\n\nYou'll see who's on your sign-up's shifts, and their phone numbers unlock on {{event_day}}.",
      button_label: "Accept invitation",
    },
    locked: inviteLocked,
  },
  {
    key: "organizer_booking_booked",
    group: "Conferences and meetings",
    name: "New booking",
    description: "Goes to the organizer when a family or guest books a conference or meeting. A calendar invite is attached.",
    fields: bookingFields,
    required: ["when"],
    starting: {
      subject: "New {{kind}} booked: {{when}}",
      heading: "A family booked a {{kind}}",
      body: "{{who}} booked a {{kind}} with you ({{event_name}}). Open the attached calendar invite to add it to your calendar.\n\nAfter the meeting, mark it Met or No-show on your Meetings page, so your records are complete.",
      button_label: "Open your Meetings page",
    },
    locked: ["Then: when, where, and who's coming"],
  },
  {
    key: "organizer_booking_changed",
    group: "Conferences and meetings",
    name: "Changed booking",
    description: "Goes to the organizer when a family or guest changes their booking. The calendar invite is updated.",
    fields: bookingFields,
    required: ["when"],
    starting: {
      subject: "{{Kind}} changed: {{when}}",
      heading: "A family changed their {{kind}}",
      body: "{{who}} changed their {{kind}}. The details below are current, and your calendar invite is updated.\n\nAfter the meeting, mark it Met or No-show on your Meetings page, so your records are complete.",
      button_label: "Open your Meetings page",
    },
    locked: ["Then: when, where, and who's coming"],
  },
  {
    key: "organizer_booking_canceled",
    group: "Conferences and meetings",
    name: "Canceled booking",
    description: "Goes to the organizer when a family or guest cancels. It takes the meeting off their calendar.",
    fields: bookingFields,
    required: ["when"],
    starting: {
      subject: "Canceled {{kind}}: {{when}}",
      heading: "A family canceled their {{kind}}",
      body: "{{who}} canceled their {{kind}} ({{when}}). The time is open again.",
      button_label: "Open your Meetings page",
    },
    locked: ["This email takes it off your calendar (in Gmail, you may need to open it first)."],
  },
  {
    key: "band_withdrew",
    group: "Band contests",
    name: "A band withdrew",
    description: "Goes to the organizer when a director withdraws their band or group.",
    fields: [
      { key: "band_name", label: "Band or group name", sample: "Lakeside HS Marching Band" },
      { key: "school", label: "School", sample: "Lakeside High School" },
      { key: "event_name", label: "Event name", sample: "Lakeside Marching Classic" },
    ],
    required: ["band_name"],
    starting: {
      subject: "{{band_name}} withdrew from {{event_name}}",
      heading: "{{band_name}} withdrew",
      body: "{{band_name}} ({{school}}) withdrew from {{event_name}}.",
      button_label: "See your bands",
    },
    locked: ["Then what happened: their registration was removed, or they're marked withdrawn on your schedule"],
  },
  {
    key: "family_booking_confirmation",
    group: "Families: conferences and meetings",
    name: "Booking confirmed",
    description: "Goes to each parent or guest on a booking when they book. A calendar invite is attached.",
    fields: familyFields,
    required: [],
    private: childFields,
    starting: {
      subject: "Booked: your {{kind}} with {{teacher}}, {{when}}",
      heading: "Your {{kind}} is booked",
      body: "Hi {{first_name}}, you're booked to meet {{teacher}} {{about_child}} ({{event_name}}).",
      button_label: "Change or cancel",
    },
    locked: ["Open the attached calendar invite to add it to your calendar, with the details.", bookingRows],
  },
  {
    key: "family_booking_changed",
    group: "Families: conferences and meetings",
    name: "Booking changed",
    description: "Goes to each parent or guest when they change their time. The calendar invite is updated.",
    fields: familyFields,
    required: [],
    private: childFields,
    starting: {
      subject: "New time: your {{kind}} with {{teacher}}, {{when}}",
      heading: "Your {{kind}} was changed",
      body: "Hi {{first_name}}, you're booked to meet {{teacher}} {{about_child}} ({{event_name}}).",
      button_label: "Change or cancel",
    },
    locked: ["Open the attached calendar invite to add it to your calendar, with the details.", bookingRows],
  },
  {
    key: "family_booking_reminder",
    group: "Families: conferences and meetings",
    name: "Reminder the day before",
    description: "Goes to each parent or guest the day before their meeting.",
    fields: familyFields,
    required: [],
    private: childFields,
    starting: {
      subject: "Tomorrow: your {{kind}} with {{teacher}}, {{when}}",
      heading: "Your {{kind}} is tomorrow",
      body: "Hi {{first_name}}, a reminder that you're meeting {{teacher}} {{about_child}} tomorrow ({{event_name}}).",
      button_label: "Change or cancel",
    },
    locked: [bookingRows],
  },
  {
    key: "family_booking_canceled",
    group: "Families: conferences and meetings",
    name: "Booking canceled",
    description: "Goes to each parent or guest when they cancel. It takes the meeting off their calendar.",
    fields: familyFields,
    required: [],
    private: childFields,
    starting: {
      subject: "Canceled: your {{kind}} with {{teacher}}",
      heading: "Your {{kind}} was canceled",
      body: "Hi {{first_name}}, the {{kind}} {{for_child}} with {{teacher}} ({{when}}) is canceled.",
      button_label: "Book another time",
    },
    locked: [bookingDeleted, calendarRemoved],
  },
  {
    key: "family_booking_canceled_by_organizer",
    group: "Families: conferences and meetings",
    name: "Canceled by the teacher or organizer",
    description: "Goes to each parent or guest when the teacher or organizer cancels their meeting.",
    fields: familyFields,
    required: [],
    private: childFields,
    starting: {
      subject: "Canceled: your {{kind}} with {{teacher}}",
      heading: "{{teacher}} canceled your {{kind}}",
      body: "Hi {{first_name}}, {{teacher}} had to cancel the {{kind}} {{for_child}} ({{when}}). You're welcome to book another open time.",
      button_label: "Book another time",
    },
    locked: [bookingDeleted, calendarRemoved, organizerNote],
  },
  {
    key: "family_booking_rescheduled",
    group: "Families: conferences and meetings",
    name: "Rescheduled by the teacher or organizer",
    description: "Goes to each parent or guest when the teacher or a co-host moves their meeting to a new time. The calendar invite is updated.",
    fields: familyFields,
    required: [],
    private: childFields,
    starting: {
      subject: "New time: your {{kind}} with {{teacher}}, {{when}}",
      heading: "{{teacher}} changed your {{kind}} time",
      body: "Hi {{first_name}}, {{teacher}} moved your {{kind}} {{about_child}} ({{event_name}}) to a new time. The details below are current.\n\nIf the new time doesn't work for you, use the button below to pick another time or cancel.",
      button_label: "Change or cancel",
    },
    locked: ["An updated calendar invite is attached, so your calendar shows the new time.", organizerNote, bookingRows],
  },
  {
    key: "family_booking_moved",
    group: "Families: conferences and meetings",
    name: "Moved to a new day",
    description: "Goes to each parent or guest when the organizer moves the whole event to a new day. The calendar invite is updated.",
    fields: familyFields,
    required: [],
    private: childFields,
    starting: {
      subject: "New day: your {{kind}} with {{teacher}}, {{when}}",
      heading: "{{teacher}} moved your {{kind}} to a new day",
      body: "Hi {{first_name}}, {{teacher}} moved {{event_name}} to a new day. Your meeting {{about_child}} is at the same time of day, on the day below.\n\nIf the new day doesn't work for you, use the button below to pick another time or cancel.",
      button_label: "Change or cancel",
    },
    locked: ["An updated calendar invite is attached, so your calendar shows the new day.", bookingRows],
  },
  {
    key: "parent_visit_confirmation",
    group: "Families: school visitor days",
    name: "Registration confirmed",
    description: "Goes to a parent when they register for a school visitor day. A calendar invite is attached.",
    fields: visitFields,
    required: [],
    starting: {
      subject: "You're registered: {{event_name}}",
      heading: "You're registered",
      body: "Hi {{first_name}}, you're registered for {{event_name}}.",
      button_label: "View, change, or cancel my registration",
    },
    locked: [
      idReminder,
      "A calendar invite is attached, so you can add the visit to your calendar with a reminder to bring your photo ID.",
      "Then: when, where, their children, and who else is coming",
    ],
  },
  {
    key: "parent_visit_reminder",
    group: "Families: school visitor days",
    name: "Reminder the day before",
    description: "Goes to each registered parent the day before a school visitor day.",
    fields: visitFields,
    required: [],
    starting: {
      subject: "Tomorrow: {{event_name}}. Bring your photo ID",
      heading: "See you tomorrow",
      body: "Hi {{first_name}}, a reminder about {{event_name}}.",
      button_label: "View, change, or cancel my registration",
    },
    locked: [idReminder, "Then: when, where, their children, and who else is coming"],
  },
  {
    key: "parent_visit_canceled",
    group: "Families: school visitor days",
    name: "Registration canceled",
    description: "Goes to a parent when they cancel their registration. It takes the visit off their calendar.",
    fields: visitFields,
    required: [],
    starting: {
      subject: "Canceled: {{event_name}}",
      heading: "Your registration was canceled",
      body: "Hi {{first_name}}, your registration for {{event_name}} ({{when}}) is canceled.",
      button_label: "Register again",
    },
    locked: ["Your children's details have been deleted.", calendarRemoved],
  },
  {
    key: "parent_visit_already",
    group: "Families: school visitor days",
    name: "Already registered",
    description: "Goes to a parent when someone registers their email again. Nothing changes; it gives them their own link.",
    fields: visitFields,
    required: [],
    starting: {
      subject: "Your registration: {{event_name}}",
      heading: "You're already registered",
      body: "Hi {{first_name}}, someone (we hope it was you) tried to register this email again for {{event_name}} ({{when}}). Nothing was changed.\n\nTo see, change, or cancel your registration, use the button below. If this wasn't you, you can ignore this email.",
      button_label: "View or change my registration",
    },
    locked: [],
  },
  {
    key: "volunteer_signup",
    group: "Volunteers",
    name: "Signed up",
    description: "Goes to a volunteer when they sign up for shifts. One shift comes with a calendar invite; with several, each gets its own invite email.",
    fields: volunteerFields,
    required: [],
    starting: {
      subject: "You're signed up: {{event_name}}",
      heading: "You're signed up for {{event_name}}",
      body: "Thanks, {{first_name}}. Here are your shift details {{at_venue}}.",
      button_label: "View or cancel my shifts",
    },
    locked: ["Who else signed up for the same shifts, if anyone", "How their calendar invite works", shiftRows],
  },
  {
    key: "volunteer_reminder",
    group: "Volunteers",
    name: "Reminder the day before",
    description: "Goes to each volunteer the day before their shifts.",
    fields: volunteerFields,
    required: [],
    starting: {
      subject: "Tomorrow: your volunteer shift at {{event_name}}",
      heading: "See you tomorrow at {{event_name}}",
      body: "Hi {{first_name}}, a reminder that you're volunteering tomorrow {{at_venue}}. Here are your shift details.\n\nCan't make it anymore? Please cancel below so someone else can take your spot.",
      button_label: "View or cancel my shifts",
    },
    locked: ["Each sign-up's instructions, and who their lead is", shiftRows],
  },
  {
    key: "volunteer_shift_changed",
    group: "Volunteers",
    name: "Shift changed",
    description: "Goes to a volunteer when the organizer changes their shift. Their calendar invite is updated.",
    fields: volunteerFields,
    required: [],
    starting: {
      subject: "Updated: your shift at {{event_name}}",
      heading: "Your volunteer shift changed",
      body: "Hi {{first_name}}, the organizers of {{event_name}} updated your shift. Here are the new details.",
      button_label: "View or cancel my shifts",
    },
    locked: ["If you added our calendar invite, it updates automatically. If you added a copy to another calendar, please update it yourself.", shiftRows],
  },
  {
    key: "volunteer_shift_canceled",
    group: "Volunteers",
    name: "Shift canceled",
    description: "Goes to a volunteer when their shift is canceled. It takes the shift off their calendar.",
    fields: [
      ...volunteerFields,
      { key: "station", label: "Sign-up", sample: "Concessions" },
      { key: "time", label: "Shift time", sample: "4:00–6:00 PM" },
    ],
    required: [],
    starting: {
      subject: "Canceled: your shift at {{event_name}}",
      heading: "Your shift was canceled",
      body: "Hi {{first_name}}, you're no longer signed up for {{station}} ({{time}}) at {{event_name}}.\n\nThanks for letting the organizers know.",
      button_label: null,
    },
    locked: [
      "If you added our calendar invite, it will be removed from your calendar (in Gmail, you may need to open this email first). If you added a copy to another calendar, please delete it.",
    ],
  },
  {
    key: "volunteer_link",
    group: "Volunteers",
    name: "Link to their shifts",
    description: "Goes to a volunteer who asks for their link from the My volunteering page.",
    fields: [{ key: "first_name", label: "Their first name", sample: "Sam" }],
    required: [],
    starting: {
      subject: "Your volunteer shifts",
      heading: "Your volunteer shifts",
      body: "Hi {{first_name}}, here's your link to view or cancel your shifts. It's just for you.",
      button_label: null,
    },
    locked: ["Then: each event, with a View my shifts link"],
  },
  {
    key: "volunteer_file_shared",
    group: "Volunteers",
    name: "File shared",
    description: "Goes to an event's volunteers when the organizer shares a file with them.",
    fields: fileFields,
    required: [],
    starting: {
      subject: "{{Change}}: {{file_name}} · {{event_name}}",
      heading: "{{Change}}: {{file_name}}",
      body: "There's {{a_change}} file for {{event_name}} ({{event_date}}).\n\nIt's on your shifts page, along with your times.",
      button_label: "View my shifts",
    },
    locked: [],
  },
  {
    key: "director_registered",
    group: "Band and group directors",
    name: "Registered",
    description: "Goes to a director when they register their band or group.",
    fields: [...directorFields, { key: "event_dates", label: "Event dates", sample: "Oct 24, 2026" }],
    required: [],
    starting: {
      subject: "Registered: {{band_name}} at {{event_name}}",
      heading: "{{band_name}} is registered",
      body: "Thanks. {{school}} is registered for {{event_name}} ({{event_dates}}).\n\nYou can review or change your registration while registration is open. We'll email you when your times are posted.",
      button_label: "View my registration",
    },
    locked: ["Then: their classification, people, and vehicles"],
  },
  {
    key: "director_invite",
    group: "Band and group directors",
    name: "Invited to register",
    description: "Goes to a director the organizer invites to register, with their details already filled in.",
    fields: [
      { key: "first_name", label: "Their first name (blank if unknown)", sample: "Jordan" },
      { key: "host", label: "The organizer's name", sample: "Pat Rivera" },
      { key: "group", label: "band or group", sample: "band" },
      { key: "event_name", label: "Event name", sample: "Lakeside Marching Classic" },
      { key: "event_dates", label: "Event dates", sample: "Oct 24, 2026" },
      { key: "at_venue", label: "“at” and the venue (blank when there's none)", sample: "at Lakeside Stadium" },
    ],
    required: [],
    starting: {
      subject: "You're invited: {{event_name}}",
      heading: "You're invited: {{event_name}}",
      body: "Hi {{first_name}}. {{host}} would love to have your {{group}} at {{event_name}}, {{event_dates}} {{at_venue}}.\n\nYour {{group}}'s details are saved. Check them, change anything you need, and register.",
      button_label: "Review and register",
    },
    locked: ["Registration closes at the end of {the deadline}. (when there is one)"],
  },
  {
    key: "director_times_posted",
    group: "Band and group directors",
    name: "Performance times posted",
    description: "Goes to each band's directors when the performance order is published.",
    fields: [...directorFields, { key: "round", label: "performance or preliminary", sample: "performance" }],
    required: [],
    starting: {
      subject: "{{Round}} time: {{band_name}} at {{event_name}}",
      heading: "Your {{round}} time at {{event_name}}",
      body: "The performance order for {{event_name}} is posted. Here are the times for {{band_name}}.",
      button_label: "See the full schedule",
    },
    locked: [timeRows],
  },
  {
    key: "director_finals_posted",
    group: "Band and group directors",
    name: "Finals times posted",
    description: "Goes to each finalist's directors when the finals order is published.",
    fields: directorFields,
    required: [],
    starting: {
      subject: "Finals time: {{band_name}} at {{event_name}}",
      heading: "You're in the finals at {{event_name}}",
      body: "Congratulations. {{band_name}} is performing in finals. Here are your finals times.",
      button_label: "See the full schedule",
    },
    locked: [timeRows],
  },
  {
    key: "director_times_changed",
    group: "Band and group directors",
    name: "Performance times changed",
    description: "Goes to a band's directors when the organizer changes their times after publishing.",
    fields: [...directorFields, { key: "round", label: "finals, preliminary, or blank", sample: "preliminary" }],
    required: [],
    starting: {
      subject: "Time change: {{band_name}} at {{event_name}}",
      heading: "Updated {{round}} times for {{band_name}}",
      body: "The organizer updated the {{round}} schedule for {{event_name}}. Here are your current {{round}} times; please use these from now on.",
      button_label: "See the full schedule",
    },
    locked: [timeRows],
  },
  {
    key: "director_rooms_posted",
    group: "Band and group directors",
    name: "Group event schedule posted",
    description: "Goes to each group's directors when a group event's room schedule is published.",
    fields: directorFields,
    required: [],
    starting: {
      subject: "Your schedule: {{band_name}} at {{event_name}}",
      heading: "{{band_name}}'s schedule at {{event_name}}",
      body: "The schedule for {{event_name}} is posted. Here's where {{school}} needs to be, and when.",
      button_label: "See the full schedule",
    },
    locked: [roomRows],
  },
  {
    key: "director_rooms_changed",
    group: "Band and group directors",
    name: "Group event schedule changed",
    description: "Goes to a group's directors when the host changes their room times.",
    fields: directorFields,
    required: [],
    starting: {
      subject: "Time change: {{band_name}} at {{event_name}}",
      heading: "Updated times for {{band_name}}",
      body: "The host changed the schedule for {{event_name}}. Here are {{school}}'s new times.",
      button_label: "See the full schedule",
    },
    locked: [roomRows],
  },
  {
    key: "director_file_shared",
    group: "Band and group directors",
    name: "File shared",
    description: "Goes to the directors who registered when the organizer shares a file with them.",
    fields: fileFields,
    required: [],
    starting: {
      subject: "{{Change}}: {{file_name}} · {{event_name}}",
      heading: "{{Change}}: {{file_name}}",
      body: "There's {{a_change}} file for {{event_name}} ({{event_date}}).\n\nSign in with the email you registered your band with to open it.",
      button_label: "Open {{file_name}}",
    },
    locked: [],
  },
];

export const systemEmail = (key: string) => SYSTEM_EMAILS.find((e) => e.key === key);

/** Fields every email has. */
export const COMMON_FIELDS: SystemEmailField[] = [{ key: "brand", label: "Our product name", sample: "" }];

const FIELD = /\{\{\s*([A-Za-z_]+)\s*\}\}/g;

/** The fields an email knows, with {{Kind}}-style capitalized versions allowed for any field. */
function known(email: SystemEmail, key: string) {
  const k = key[0].toLowerCase() + key.slice(1);
  return k === "brand" || email.fields.some((f) => f.key === k);
}

/** Fill {{fields}}. {{Field}} with a capital letter capitalizes the value. Unknown fields stay as typed. */
export function fillSystemText(email: SystemEmail, text: string, vars: Record<string, string>) {
  return text.replace(FIELD, (whole, key: string) => {
    if (!known(email, key)) return whole;
    const k = key[0].toLowerCase() + key.slice(1);
    const v = vars[k] ?? "";
    return key[0] !== k[0] && v ? v[0].toUpperCase() + v.slice(1) : v;
  });
}

/** What's wrong with an edited version, or null. */
export function checkSystemText(email: SystemEmail, t: SystemEmailText): string | null {
  if (!t.subject.trim()) return "Add a subject.";
  if (!t.heading.trim()) return "Add a heading.";
  if (!t.body.trim()) return "Write the message.";
  if (t.subject.length > 300 || t.heading.length > 200 || t.body.length > 5000) return "That's too long.";
  if ((t.button_label ?? "").length > 60) return "Keep the button text under 60 characters.";
  const all = `${t.subject}\n${t.heading}\n${t.body}\n${t.button_label ?? ""}`;
  const unknown = [...all.matchAll(FIELD)].map((m) => m[1]).filter((k) => !known(email, k));
  if (unknown.length) return `This email doesn't have ${[...new Set(unknown)].map((k) => `{{${k}}}`).join(", ")}. Use the fields listed under the editor.`;
  const used = new Set([...all.matchAll(FIELD)].map((m) => m[1].toLowerCase()));
  const inSubject = [...t.subject.matchAll(FIELD)].map((m) => m[1].toLowerCase());
  const hidden = (email.private ?? []).filter((k) => inSubject.includes(k));
  if (hidden.length) return `Leave ${hidden.map((k) => `{{${k}}}`).join(", ")} out of the subject: children's names never go in subjects.`;
  const missing = email.required.filter((k) => !used.has(k));
  if (missing.length) return `Keep ${missing.map((k) => `{{${k}}}`).join(", ")} in the email: people need it.`;
  return null;
}

/** The finished words: the saved version filled in, as emailLayout takes them. */
export function systemEmailWords(email: SystemEmail, t: SystemEmailText, vars: Record<string, string>) {
  // A blank field (no child's name, say) can leave a double space or a space before a comma: tidy both.
  const fill = (s: string) =>
    fillSystemText(email, s, vars)
      .replace(/[ \t]+/g, " ")
      .replace(/ ([.,;:)])/g, "$1")
      .replace(/\( /g, "(")
      .trim();
  return {
    subject: fill(t.subject),
    heading: fill(t.heading),
    paragraphs: t.body
      .replace(/\r\n/g, "\n")
      .split(/\n\s*\n/)
      .map(fill)
      .filter(Boolean),
    button: t.button_label ? fill(t.button_label) : null,
  };
}

/** Sample values for the preview and the test email. */
export const sampleVars = (email: SystemEmail, brandName: string) => ({
  brand: brandName,
  ...Object.fromEntries(email.fields.map((f) => [f.key, f.sample])),
});
