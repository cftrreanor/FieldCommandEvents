// Ready-made events for the QA site's control center (src/app/qa/control-actions.ts).
// Each one is a published event in the reviewer's own organization, dated from
// today, and filled with demo mode's sample people for its kind.

export type Scenario = {
  id: string;
  label: string;
  hint: string;
  type: "band_contest" | "group_event" | "volunteer" | "school_visit" | "fair" | "conference" | "meeting";
  name: string;
  /** Days from today: 0 is today. */
  inDays: number;
  start: string;
  end: string;
  venueName: string;
  venueAddress: string;
  open?: { volunteers?: boolean; bands?: boolean; parents?: boolean; order?: boolean };
};

const SCHOOL = { venueName: "Cedar Ridge High School", venueAddress: "100 Panther Way, Austin, TX 78701" };

export const SCENARIOS: Scenario[] = [
  {
    id: "band-open",
    label: "Band contest, registration open",
    hint: "In 3 weeks. Bands and volunteers can sign up.",
    type: "band_contest",
    name: "Cedar Ridge Marching Invitational",
    inDays: 21,
    start: "08:00",
    end: "22:00",
    ...SCHOOL,
    open: { volunteers: true, bands: true },
  },
  {
    id: "band-today",
    label: "Band contest, happening today",
    hint: "Today, with the performance order posted. For contest-day screens.",
    type: "band_contest",
    name: "Lakeview Marching Classic",
    inDays: 0,
    start: "07:00",
    end: "23:00",
    ...SCHOOL,
    open: { volunteers: true, order: true },
  },
  {
    id: "choir",
    label: "Choir festival",
    hint: "In 10 days, with groups and rooms.",
    type: "group_event",
    name: "Spring Choir Festival",
    inDays: 10,
    start: "08:00",
    end: "17:00",
    ...SCHOOL,
    open: { volunteers: true, bands: true },
  },
  {
    id: "fair",
    label: "School fair",
    hint: "In 2 weeks, with booths and volunteer shifts.",
    type: "fair",
    name: "Fall Family Fair",
    inDays: 14,
    start: "10:00",
    end: "15:00",
    venueName: "Cedar Ridge Elementary",
    venueAddress: "400 Oak St, Austin, TX 78702",
    open: { volunteers: true },
  },
  {
    id: "volunteer",
    label: "Volunteers and sign-ups",
    hint: "In a week, with shifts to sign up for.",
    type: "volunteer",
    name: "Community Cleanup Day",
    inDays: 7,
    start: "09:00",
    end: "14:00",
    venueName: "Riverside Park",
    venueAddress: "2100 Riverside Dr, Austin, TX 78741",
    open: { volunteers: true },
  },
  {
    id: "visit",
    label: "Visitor registration and check-in",
    hint: "In 5 days. Families register and check in at the door.",
    type: "school_visit",
    name: "Thanksgiving Lunch with Families",
    inDays: 5,
    start: "11:00",
    end: "13:00",
    venueName: "Cedar Ridge Elementary",
    venueAddress: "400 Oak St, Austin, TX 78702",
    open: { parents: true },
  },
  {
    id: "conference",
    label: "Parent-teacher conferences",
    hint: "In a week, with families already booked.",
    type: "conference",
    name: "Fall Parent-Teacher Conferences",
    inDays: 7,
    start: "15:00",
    end: "18:00",
    venueName: "Cedar Ridge Elementary",
    venueAddress: "400 Oak St, Austin, TX 78702",
  },
  {
    id: "meeting",
    label: "Meetings",
    hint: "In a week, with people already booked.",
    type: "meeting",
    name: "Fall Advising Meetings",
    inDays: 7,
    start: "09:00",
    end: "12:00",
    venueName: "Cedar Ridge Booster Office",
    venueAddress: "100 Panther Way, Austin, TX 78701",
  },
];

/** The pages a reviewer can jump to, for every event of a kind (paths after /e/{slug}). */
export const PUBLIC_PAGES: Record<Scenario["type"], { label: string; path: string }[]> = {
  band_contest: [
    { label: "Public page", path: "" },
    { label: "Band registration", path: "/bands" },
    { label: "Volunteer sign-up", path: "/volunteer" },
  ],
  group_event: [
    { label: "Public page", path: "" },
    { label: "Group registration", path: "/bands" },
    { label: "Volunteer sign-up", path: "/volunteer" },
  ],
  volunteer: [
    { label: "Public page", path: "" },
    { label: "Volunteer sign-up", path: "/volunteer" },
  ],
  fair: [
    { label: "Public page", path: "" },
    { label: "Volunteer sign-up", path: "/volunteer" },
  ],
  school_visit: [
    { label: "Public page", path: "" },
    { label: "Family registration", path: "/parents" },
  ],
  conference: [{ label: "Booking page", path: "/book" }],
  meeting: [{ label: "Booking page", path: "/book" }],
};

/** The site's own pages, as the control center lists them. */
export const SITE_PAGES: { group: string; pages: { label: string; href: string }[] }[] = [
  {
    group: "Website",
    pages: [
      { label: "Homepage", href: "/" },
      { label: "Band contests", href: "/band-contests" },
      { label: "Choir festivals", href: "/choir-festivals" },
      { label: "School fairs", href: "/school-fairs" },
      { label: "Volunteers and sign-ups", href: "/volunteer-events" },
      { label: "Parent check-in", href: "/parent-check-in" },
      { label: "Parent-teacher conferences", href: "/parent-teacher-conferences" },
      { label: "Meetings", href: "/meetings" },
      { label: "Meetings", href: "/meetings" },
      { label: "For administrators", href: "/school-administrators" },
      { label: "Student data privacy", href: "/student-data-privacy" },
    ],
  },
  {
    group: "Organizer screens",
    pages: [
      { label: "Your events", href: "/dashboard" },
      { label: "New event", href: "/dashboard/events/new" },
      { label: "Account", href: "/dashboard/account" },
      { label: "Admin", href: "/admin" },
    ],
  },
  {
    group: "Volunteers, emails, and comments",
    pages: [
      { label: "A volunteer's page", href: "/my" },
      { label: "Outbox", href: "/qa/outbox" },
      { label: "Comments", href: "/qa/comments" },
    ],
  },
];
