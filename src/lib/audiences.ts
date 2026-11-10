import type { HowStep } from "@/components/how-it-works";
import { brand } from "@/lib/brand";
import { PILOT_END_LABEL } from "@/lib/pilot";
import type { IconName } from "./icons";

/**
 * The pages for each kind of event (/volunteer-events, /band-contests, /choir-festivals…),
 * written for the people who run them and the words they search for.
 * Every claim here must match what the product really does: no payments,
 * texting, ticketing, waitlists or exports.
 */
export type Audience = {
  path: `/${string}`;
  /** The event type (src/lib/event-types.ts) ticked on this page's pilot form. */
  eventType: string;
  icon: IconName;
  /** Short name, for links between the pages. */
  name: string;
  /** The browser tab and search result title (the brand is added after it). */
  metaTitle: string;
  metaDescription: string;
  eyebrow: string;
  headline: string;
  intro: string;
  /** What it replaces: the tools people use today. */
  replaces: string[];
  /** "How it works": 3 or 4 steps, each with a phone screenshot. */
  steps: HowStep[];
  /** Each with an optional phone screenshot of it (public/screens/, sample data only). */
  sections: { title: string; body: string; points: string[]; screen?: { src: string; alt: string } }[];
  privacy: string[];
  faqs: { q: string; a: string }[];
};

export const audiences = {
  bands: {
    path: "/band-contests",
    eventType: "band_contest",
    icon: "band",
    name: "Band contests",
    metaTitle: "Band Contest Registration, Scheduling & Check-in Software",
    metaDescription:
      "Run a marching band contest or jazz festival: online band registration with saved details, a published performance schedule with finals, a live order for spectators, and contest day check-in from parking to the gate.",
    eyebrow: "For band directors and band booster clubs",
    headline: "From the first registration to the last band through the gate",
    intro:
      "Run a marching invitational, jazz festival, or solo & ensemble on one page. Directors register online, you publish the schedule, volunteers check every band through on their own phones, and families follow along live.",
    replaces: [
      "Registration forms emailed back and forth",
      "A schedule retyped and re-sent every time something changes",
      "Clipboards at the parking lot, check-in table, and gate",
      "Group texts asking where a band is",
    ],
    sections: [
      {
        title: "Band registration that remembers",
        body: "Share one link, and directors fill in their school, band, classification, directors, student and chaperone counts, vehicles, and any conflicts or staging needs. They confirm with a code we email them, with no account to set up first.",
        points: [
          "Invite directors from past contests, or import last year's list from a spreadsheet, and their details are filled in for them",
          "See every registered band with totals for students, chaperones, and vehicles, filter by classification, and download the list",
          "Set a chaperone limit and a deadline that closes on its own, then reopen with a new deadline if a band asks for more time",
          "Headcounts only: student names are never collected",
        ],
      },
      {
        title: "What visiting directors get",
        body: "Every director has one page for their band: when to be where, your information for directors, and your maps and documents. Fewer calls and emails land on you.",
        points: [
          "Their warm-up and performance times, added to their calendar in one tap",
          "A checklist of what's next, then live check-in steps on contest day",
          "Changes allowed until your deadline, and a withdraw button if plans change, which emails you",
        ],
        screen: {
          src: "/screens/band-director-page.webp",
          alt: "A band director's page on a phone: the band, the contest, a What's next checklist, and their performance time.",
        },
      },
      {
        title: "A performance schedule everyone can trust",
        body: "Build the preliminaries running order with warm-up and performance times, locations, and breaks, then publish it for directors and spectators.",
        points: [
          "Directors are emailed when their time changes, and anyone with the schedule open is told it was updated",
          "Running late? Push the rest of the schedule back in one step, and affected directors are emailed",
          "Publish finals times first, then reveal the finalists when you're ready",
        ],
      },
      {
        title: "Contest day check-in, your way",
        body: "Set the stops every band moves through, like Parking, Check-in, Warm-up, and the Gate. Volunteers at each stop tap a band through on any phone, tablet, or laptop.",
        points: [
          "Each person sees buttons for their own jobs, like Check in bands or Push schedule back",
          "Assign parking spots as buses, trucks, and trailers arrive, and see who's on track or running late",
          "Every tap records who made it and when, and can be undone",
          `Volunteers for concessions, parking, and the gate sign up for shifts on the same event, with printable badges that carry your logo`,
        ],
        screen: {
          src: "/screens/band-checkin-station.webp",
          alt: "Parking check-in on contest day on a phone: a band marked late, with buttons for buses and equipment, and event-day buttons along the bottom.",
        },
      },
      {
        title: "A live order for spectators",
        body: "Families and fans follow the public schedule on their phones: who just performed, who's up next, and the full order, under your logo and colors.",
        points: [
          "Spectators never see contact details or headcounts",
          "Post a banner for a weather delay or schedule change",
          "Share parking maps and director packets with exactly the people who need them",
        ],
        screen: {
          src: "/screens/band-live-order.webp",
          alt: "The public contest page on a phone in the host's colors, with the host's logo and the live performance order.",
        },
      },
    ],
    steps: [
      {
        title: "Open registration",
        body: "Set your classifications, a chaperone limit, and a deadline, then invite directors from your past contests.",
        screen: "/screens/band-registration-page.webp",
        alt: "The organizer's Band Registration page: registration open, a deadline, and the registered bands with totals and classification filters.",
      },
      {
        title: "Directors register",
        body: "Directors fill in their school, band, directors, student counts, and vehicles, then confirm with a code. They can update it until registration closes.",
        screen: "/screens/band-registration-confirm-code.webp",
        alt: "The band registration form on a phone, with a note that it takes about 5 minutes and is confirmed with an emailed code.",
      },
      {
        title: "Publish the schedule",
        body: "Post the performance order and finals. Directors and spectators see it on the public page.",
        screen: "/screens/band-performance-schedule.webp",
        alt: "The public performance schedule: preliminaries with a lunch break, and the finals.",
      },
      {
        title: "Run contest day",
        body: "Check bands through parking, check-in, and warm-up, and see who's on track at a glance.",
        screen: "/screens/event-day-dashboard-blue.webp",
        alt: "The contest day dashboard: a schedule-change banner and how many bands have parked, checked in, and warmed up.",
      },
    ],
    privacy: [
      "Only your organizers and each band's own director see that band's contact details.",
      "Coordinators see each band's name, school, and progress. Volunteer Leads also see headcounts and vehicles.",
      "Directors' personal details are removed 2 years after the contest. The band, school, and headcounts stay for your records.",
      "Volunteers' phone numbers are deleted 10 days after the contest.",
    ],
    faqs: [
      {
        q: "How do band directors register for our contest?",
        a: "Share one registration link. Directors fill in the form, with no account to set up first, then confirm with a code we email them. Directors you invite by email register in one tap with no code. They see their performance time as soon as you publish the schedule.",
      },
      {
        q: "Can returning bands reuse last year's registration?",
        a: "Yes. Invite the directors who registered at your earlier contests, or import last year's list from a spreadsheet. Their link opens registration with their band details already filled in.",
      },
      {
        q: "What if a band needs to withdraw, or asks for more time?",
        a: "Directors can withdraw from their own page, and you're emailed. While registration is open and before you post times, their registration is removed. After that, the band is marked withdrawn on the schedule so your order keeps its shape. If a band asks for more time after your deadline, reopen registration with a new deadline in one step.",
      },
      {
        q: "Does it collect entry fees?",
        a: `No, ${brand.name} doesn't process payments. Add your entry fee and how to pay to the information for directors, which shows on the registration page, and collect it the way you do today. Directors never pay a platform fee.`,
      },
      {
        q: "What happens when the contest runs late?",
        a: "Push the rest of the schedule back by however many minutes you need. Affected directors are emailed their new time, and the public schedule and anyone with it open are updated.",
      },
      {
        q: "Can parents and fans follow the performance order?",
        a: "Yes. The public event page shows the schedule live on contest day: who just performed and who's up next, with no contact details or headcounts. It carries your logo and colors.",
      },
    ],
  },

  groups: {
    path: "/choir-festivals",
    eventType: "group_event",
    icon: "group",
    name: "Choir & group festivals",
    metaTitle: "Choir, Orchestra & Group Festival Scheduling Software",
    metaDescription:
      "Run a choir or orchestra festival, theater, or speech and debate event: groups register online and move through your rooms on a schedule built for you, while directors and families follow every room live.",
    eyebrow: "For choir directors and fine arts directors",
    headline: "Festivals that stay on time",
    intro:
      "For choir and orchestra festivals, theater, UIL academics, and speech and debate, groups register online and move through your rooms on a schedule built for you. Directors and families follow every room live.",
    replaces: [
      "Room rotations worked out by hand in a spreadsheet",
      "Runners sent to see whether a room is ready",
      "Printed itineraries that are out of date by mid-morning",
      "A separate emailed form for every group",
    ],
    sections: [
      {
        title: "Registration for every group",
        body: "Share one link, and directors fill in their school, group, classification, directors, participant and chaperone counts, buses, and any conflicts or staging needs. They confirm with a code we email them, with no account to set up first.",
        points: [
          "Import last year's directors from a spreadsheet, and their details are filled in for them",
          "See every registered group with totals for participants, chaperones, and buses, filter by classification, and download the list",
          "Set a chaperone limit and a deadline that closes on its own, then reopen with a new deadline if a director asks for more time",
          "Headcounts only: student names are never collected",
        ],
      },
      {
        title: "Rooms and a schedule built for you",
        body: "Add your rooms, such as warm-up, performance, sight-reading, or a clinic, and the order groups move through them. Set the start time, the minutes between groups, and the passing time, and every group's itinerary is worked out for you.",
        points: [
          "Add a note to each room, like “Room 112, east hallway”, and list hospitality rooms that aren't part of the rotation",
          "Change a group's starting order, skip a room for one group, add a lunch break, or adjust any time by hand",
          "Publish, and every director is emailed their group's times. Change a time later, and you can email only the directors it affects",
        ],
      },
      {
        title: "What visiting directors get",
        body: "Every director has one page for their group: each room and time, your information for directors, and your maps and documents. Fewer calls and emails land on you.",
        points: [
          "Their room-by-room itinerary, added to their calendar in one tap",
          "A checklist of what's next, then their group's progress live on the day",
          "Changes allowed until your deadline, and a withdraw button if plans change, which emails you",
        ],
        screen: {
          src: "/screens/group-director-itinerary.webp",
          alt: "A choir director's page on a phone: the festival, a What's next checklist, and their group's room-by-room times.",
        },
      },
      {
        title: "Every room on time",
        body: "On the day, anyone on your team taps a group Arrived when it reaches the building and Done as it finishes each room, on any phone, tablet, or laptop.",
        points: [
          "One view of all groups, plus a view for each room, with any group running over shown at a glance",
          "Running behind? Push the rest of the schedule back in one step, and email the directors it affects",
          "Every tap shows who made it, and can be undone",
          "Volunteers sign up for shifts on their phone without making an account, get a reminder the day before, and wear printable badges that carry your logo",
        ],
        screen: {
          src: "/screens/group-room-taps.webp",
          alt: "One room's view on event day on a phone: the group on now, the group up next, and a Done tap that shows who made it.",
        },
      },
      {
        title: "Families follow each room live",
        body: "The public event page shows who's on now and up next in every room, under your logo and colors, so families know where to be.",
        points: [
          "Families never see contact details or headcounts",
          "Post a banner when something changes, and anyone with the schedule open is told it was updated",
          "Share maps and director packets with exactly the people who need them",
        ],
        screen: {
          src: "/screens/group-public-rooms.webp",
          alt: "The public festival page on a phone in the host's colors, with the host's logo and the group on now in each room.",
        },
      },
    ],
    steps: [
      {
        title: "Set up rooms and the order",
        body: "Add the rooms every group visits. Each group's times are worked out for you, room by room.",
        screen: "/screens/group-rooms-schedule.webp",
        alt: "Rooms & Schedule Setup: each choir's warm-up, main stage, and sight-reading times.",
      },
      {
        title: "Groups register",
        body: "Directors fill in their school, group, directors, and headcounts, then confirm with a code. They can update it until registration closes.",
        screen: "/screens/group-registration-confirm-code.webp",
        alt: "The group registration form on a phone, with a note that it takes about 5 minutes and is confirmed with an emailed code.",
      },
      {
        title: "Families follow each room live",
        body: "The public page shows who's on now and up next in every room.",
        screen: "/screens/group-room-schedule-live.webp",
        alt: "The public schedule, room by room, with the group on now and the group up next.",
      },
      {
        title: "Run the day",
        body: "Tap groups Arrived and Done in each room, and see who's running over.",
        screen: "/screens/group-event-day.webp",
        alt: "The event day page: which groups are here, which are running over, and Done buttons for each room.",
      },
    ],
    privacy: [
      "Only your organizers and each group's own director see that group's contact details.",
      "Families see room times, never contact details or headcounts.",
      "Directors' personal details are removed 2 years after the festival. The group, school, and headcounts stay for your records.",
      "Volunteers' phone numbers are deleted 10 days after the festival.",
    ],
    faqs: [
      {
        q: "How is the room schedule built?",
        a: "Add your rooms in the order groups move through them and how long each takes, then set the start time, the minutes between groups, and the passing time. Every group's itinerary is worked out for you, and you can change the order, skip rooms, add breaks, or adjust any time before you publish.",
      },
      {
        q: "Does it work for orchestra, theater, or speech and debate?",
        a: "Yes. Any event where groups register and move through rooms on a schedule works the same way: orchestra and choir festivals, theater, speech and debate, and more.",
      },
      {
        q: "What if a room falls behind?",
        a: "Your team taps each group Arrived and Done, so you can see where every room stands and which groups are running over. If the day runs late, push the rest of the schedule back by however many minutes you need, and email the directors whose times moved. The public page updates for families.",
      },
      {
        q: "What if a group needs to withdraw, or asks for more time?",
        a: "Directors can withdraw from their own page, and you're emailed. While registration is open and before you publish room times, their registration is removed. After that, the group is marked withdrawn on your group list, and its room times stay in place until you change the schedule. If a director asks for more time after your deadline, reopen registration with a new deadline in one step.",
      },
      {
        q: "Can families see where their child's group is?",
        a: "Yes. The public event page shows each room's current and next group on the day, on any phone, with no app to download.",
      },
      {
        q: "Do visiting directors pay or need an app?",
        a: `No. Visiting directors use ${brand.name} free, in their phone's web browser. Only the school or organization hosting the festival pays to use it. Any festival fee is set and collected by the organizer.`,
      },
    ],
  },

  fairs: {
    path: "/school-fairs",
    eventType: "fair",
    icon: "fair",
    name: "School fairs & fundraisers",
    metaTitle: "School Fair, Carnival & Fundraiser Planning Software for PTOs",
    metaDescription:
      "Plan a fall festival, carnival, or PTO fundraiser: organize booths and community partners by zone, staff every booth with volunteers, check partners in on the day, and share a public page of everything at the event.",
    eyebrow: "For PTO and PTA leaders",
    headline: "School fairs without the spreadsheets",
    intro:
      "Keep every booth, community partner, and volunteer shift for your fall festival, carnival, or fundraiser in one place. Partners check in as they arrive, and families see everything at the event on one public page.",
    replaces: [
      "A booth spreadsheet that only one person can find",
      "Volunteer sign-up sheets passed around at pickup",
      "Texting partners to see if they've arrived",
      "Flyers reprinted when a booth changes",
    ],
    sections: [
      {
        title: "Booths, organized by zone",
        body: "Add every booth with its location, a short description, and the partner or vendor running it, then group them into zones. Partners don't make an account or fill in a form: you add them.",
        points: [
          "Start with Game Zone, Activity Stations, Marketplace, Showcase, and Food & Drinks, or name your own zones",
          "Choose which booths are listed publicly",
          "Keep each partner's contact details private to your team",
        ],
      },
      {
        title: "Volunteers for every booth",
        body: "Share one link or QR code, and parents pick a sign-up and a shift on their phone without making an account. They get a confirmation, a calendar invite, and a reminder the day before.",
        points: [
          "Give each volunteer sign-up a zone, and a Coordinator to run it",
          "Parents can sign up with their student under one sign-up, and sign-ups like parking can be adults only",
          "Already have volunteers lined up in a spreadsheet? Import them onto their shifts",
          "Print name badges that carry your logo",
        ],
        screen: {
          src: "/screens/fair-volunteer-badges.webp",
          alt: "A printable volunteer name badge with the organizer's logo, the volunteer's name and shift, and a QR code for event info.",
        },
      },
      {
        title: "A “What's at the event” page",
        body: "Families see everything at your fair, zone by zone, on one public page under your logo and colors. It's a simple way to thank the partners and sponsors who make the day happen.",
        points: [
          "Share it with a link, or download a QR code for flyers, emails, and slides",
          "Post a banner for a weather change or a new start time",
          "Share a map of the grounds with everyone, or a packet with just your volunteers",
        ],
        screen: {
          src: "/screens/fair-whats-here.webp",
          alt: "The public fair page on a phone in the organizer's colors, with its logo, a volunteer sign-up link, and the booths in the Game Zone.",
        },
      },
      {
        title: "Fair day, from any phone",
        body: "On the day, your team checks in partners and volunteers on any phone, tablet, or laptop. Each person sees buttons for their own jobs, like Check in booths and partners or Check in volunteers.",
        points: [
          "See how many booths have arrived and which are still waiting, updated on its own",
          "Tap partners Arrived as they set up, and undo a wrong tap",
          "Check volunteers in at the desk, add walk-ups, and release no-shows so someone else can take the spot",
        ],
        screen: {
          src: "/screens/fair-day-booth-checkin.webp",
          alt: "Fair day check-in on a phone: how many booths have arrived, the ones not here yet, and Arrived buttons for each booth.",
        },
      },
    ],
    steps: [
      {
        title: "Add booths by zone",
        body: "Games, activities, vendors, and showcases, each with the partner who runs it.",
        screen: "/screens/fair-booths-by-zone.webp",
        alt: "Booths & Partners: zones and booths set up, and partners checked in as they arrive.",
      },
      {
        title: "Staff every booth",
        body: "Volunteers pick their own shifts on their phone and get a reminder the day before.",
        screen: "/screens/fair-volunteer-signup.webp",
        alt: "A volunteer picking a shift on the event's sign-up page.",
      },
      {
        title: "Share what's at the fair",
        body: "Families see every booth by zone on one public page that thanks your partners.",
        screen: "/screens/fair-public-page.webp",
        alt: "The public What's at the event page, with booths grouped into Game Zone and Activity Stations.",
      },
      {
        title: "Check partners in",
        body: "On the day, anyone on your team taps partners Arrived as they set up.",
        screen: "/screens/fair-partner-checkin.webp",
        alt: "The partner check-in list: one booth marked Arrived, others waiting.",
      },
    ],
    privacy: [
      "Partners' contact details never appear on the public page and are removed 15 months after the event.",
      "Volunteers' phone numbers are deleted 10 days after the event.",
      "Student volunteers under 18 are stored by first name and last initial, with their parent's contact details.",
      "Coordinators see their volunteers' phone numbers only on event day.",
    ],
    faqs: [
      {
        q: "Can we make our own zones?",
        a: "Yes. Pick from the suggested zones or type any zone name you like, such as Bounce Houses or Bake Sale. Booths and volunteer sign-ups can both have a zone.",
      },
      {
        q: "How do volunteers sign up for booths?",
        a: "Share one link or QR code. Volunteers pick a sign-up and shift on their phone without making an account, and get a confirmation, a calendar invite, and a reminder the day before.",
      },
      {
        q: "Do our partners and vendors need to do anything?",
        a: "No. You add each booth and the partner running it, and their contact details stay private to your team. Partners don't make an account or fill in a form. On the day, your team taps them Arrived as they set up.",
      },
      {
        q: "What about volunteers who walk up on the day?",
        a: "Add them at the volunteer desk in a few taps, with no account needed, and they're checked in right away. If someone doesn't show, release their spot so a walk-up can take it.",
      },
      {
        q: "Can students volunteer at our fair?",
        a: "Yes. A parent can sign up with their student under one sign-up. Volunteers under 18 are stored by first name and last initial with the parent's contact details, and you can mark any sign-up as adults only.",
      },
      {
        q: "Does it sell tickets or take payments?",
        a: `No. ${brand.name} organizes your booths, partners, and volunteers. Keep selling tickets and taking payments the way you do today.`,
      },
    ],
  },

  volunteers: {
    path: "/volunteer-events",
    eventType: "volunteer",
    icon: "volunteer",
    name: "Volunteers and sign-ups",
    metaTitle: "Online Sign-up Sheets & Volunteer Scheduling, No Ads",
    metaDescription:
      "Online sign-up sheets and volunteer scheduling for schools, PTOs, congregations, clubs, nonprofits, and community groups. Organizers sign in to run their events. Volunteers, families, and guests join from the organizer's link and are never asked to make an account or shown ads.",
    eyebrow: "For volunteer shifts, potlucks, and anything with spots to fill",
    headline: "Sign-up sheets and volunteer shifts without the ads",
    intro:
      "You set it up from your organizer account. Volunteers, families, and guests sign up from your link, with up to four others at once, and are never asked to make an account or shown ads.",
    replaces: [
      "Sign-up sites covered in ads",
      "Making everyone who signs up create an account",
      "Paper sheets on a clipboard and shared spreadsheets",
      "Sending reminders one by one the night before",
      "Guessing who actually showed up",
    ],
    sections: [
      {
        title: "Shifts and things to bring that fill evenly",
        body: "Set up each sign-up, its shifts, and how many people each shift needs. Sign-ups stop when a shift is full, so you never end up with ten people at one table and nobody at the next.",
        points: [
          "Build a day of equal shifts in one step, or add each shift by hand",
          "Add where volunteers should report, any instructions, and who's leading each sign-up",
          "Mark sign-ups as adults only, and open or close sign-ups whenever you're ready",
          "Make any sign-up a list of things to bring, like sides, desserts, and drinks for a potluck, with how many of each you need",
        ],
      },
      {
        title: "Sign-ups and reminders, without accounts",
        body: "Share one link or QR code. Volunteers pick one shift or several on their phone and see how many spots are left, with no account to make and nothing to download.",
        points: [
          "Sign up with up to four others, and volunteers under 18 use a guardian's contact details",
          "A confirmation with a calendar invite, an update if their shift changes, and a reminder the day before with their sign-up, time, where to report, and their lead's name and phone",
          "A private link lets each volunteer see their shifts, sign up for more, or cancel",
        ],
        screen: {
          src: "/screens/volunteer-shift-picker.webp",
          alt: "The volunteer sign-up page on a phone in the organizer's colors: sign-ups with their shifts and how many spots are left.",
        },
      },
      {
        title: "Ready for the day",
        body: "Everything volunteers need before they arrive, and a way to reach them when plans change.",
        points: [
          "Already have volunteers lined up in a spreadsheet? Import them onto their shifts, and email their confirmations if you like",
          "Print name badges with your logo and color, a QR code, and blank badges for walk-ups",
          "Share a packet or map with just your volunteers, on their own page",
          "Post a message to volunteers or your leads when plans change",
        ],
        screen: {
          src: "/screens/volunteer-my-shifts.webp",
          alt: "A volunteer's own page on a phone: their shift, where to report, their lead's contact details, and the volunteer packet.",
        },
      },
      {
        title: "Check-in on any device",
        body: "Check volunteers in at the desk with one tap, on any phone, tablet, or laptop. Walk-ups can be added and checked in on the spot, even onto a full shift.",
        points: [
          "Search for anyone by name, and undo a wrong tap",
          "See how many have arrived out of how many signed up at each sign-up, and who isn't here yet for shifts that have started",
          "Release a no-show to free up their spot",
          "The desk updates on its own, so everyone checking people in sees the same list",
        ],
        screen: {
          src: "/screens/volunteer-desk-overview.webp",
          alt: "The volunteer check-in desk on a phone: arrived and signed-up counts by sign-up, and who isn't here yet.",
        },
      },
      {
        title: "Leads for every sign-up",
        body: "Invite Volunteer Leads to run the desk and Coordinators to run a sign-up. Each sees what their role needs, and nothing they don't.",
        points: [
          "Coordinators see their volunteers' phone numbers only on event day",
          "Volunteers see their lead's contact details, so they know who to find",
        ],
      },
    ],
    steps: [
      {
        title: "Set up sign-ups and shifts",
        body: "Add sign-ups with their leads, then fill the day with shifts.",
        screen: "/screens/set-up-shifts-blue.webp",
        alt: "Setting up a sign-up with its morning and late-morning volunteer shifts.",
      },
      {
        title: "Share a link or QR code",
        body: "Volunteers pick their own shifts and get a confirmation, calendar invite, and reminder.",
        screen: "/screens/volunteer-signup-blue.webp",
        alt: "A volunteer picking a shift on the event's sign-up page.",
      },
      {
        title: "Check volunteers in",
        body: "Tap Check in as people arrive, see open spots, and add walk-ups.",
        screen: "/screens/volunteer-checkin-desk.webp",
        alt: "The volunteer check-in desk: one shift's volunteers, some checked in, with Check in buttons.",
      },
    ],
    privacy: [
      "Volunteers never make an account, and their phone numbers are deleted 10 days after the event.",
      "Volunteers under 18 are stored by first name and last initial, with a guardian's contact details.",
      "Coordinators see their volunteers' contact details only on event day.",
      "No ads, no spam, and emails used only for your event",
    ],
    faqs: [
      {
        q: "Who needs an account, and what does it cost?",
        a: `Only the organizer. Your events live in your account, free during the pilot until ${PILOT_END_LABEL}. After the pilot, organizers pay to use ${brand.name}, and we'll talk with you before anything changes. Nothing renews or charges on its own. Everyone signing up uses your link at no charge, and is never asked to make an account.`,
      },
      {
        q: "Do volunteers need to create an account?",
        a: "No. Volunteers sign up from a link or QR code with just their name and contact details. Their confirmation email includes a private link to see their shifts, sign up for more, or cancel.",
      },
      {
        q: "Will people see ads?",
        a: `No. There are no ads anywhere in ${brand.name}, and we only email people about the event they signed up for.`,
      },
      {
        q: "Can I make a potluck sign-up?",
        a: "Yes. Make any sign-up a list of things to bring, like sides, desserts, and drinks, with how many of each you need. People pick what they'll bring, and the list shows what's still needed.",
      },
      {
        q: "Do volunteers get reminders?",
        a: "Yes. A confirmation email with a calendar invite when they sign up, an update if their shift changes, and a reminder the day before with their sign-up, time, where to report, and their lead.",
      },
      {
        q: "How do we keep track of who showed up?",
        a: "Check volunteers in at the desk with one tap on any device. Each sign-up shows how many have arrived out of how many signed up, and the desk lists who isn't here yet for shifts that have started. You can add walk-ups or release no-shows on the spot.",
      },
      {
        q: "Can people sign up together?",
        a: "Yes. One person can sign up with up to four others, who take the same shifts or pick their own. Volunteers under 18 use a guardian's contact details, and sign-ups can be marked adults only.",
      },
      {
        q: "Can we use it for volunteers at other kinds of events too?",
        a: "Yes. Volunteer sign-ups and check-in are built into every kind of event, from festivals and fairs to contests and community days.",
      },
    ],
  },

  parents: {
    path: "/parent-check-in",
    eventType: "school_visit",
    icon: "school",
    name: "Parent & visitor check-in",
    metaTitle: "Parent & Visitor Check-in for School Events",
    metaDescription:
      "Parent registration and visitor check-in for family lunches, open houses, performances, and award days. Parents register each child, teacher, and grade, get a photo ID reminder, and are checked in at the door on any device.",
    eyebrow: "For school front offices and administrators",
    headline: "Parent check-in without the paper lists",
    intro:
      "For family lunches, class parties, open houses, and award days, parents register ahead with each child's name, teacher, and grade. Your front office checks every adult in at the door, and children's details are deleted 30 days after the event.",
    replaces: [
      "A spreadsheet of children's names that never gets deleted",
      "Printed lists checked off by hand at the front door",
      "Reminder emails about photo ID sent by hand",
      "Headcounts guessed for the cafeteria or gym",
    ],
    sections: [
      {
        title: "Parents register ahead",
        body: "Share one link or QR code. Parents enter their name and email, an optional mobile number, any other adults coming with them, and each child's name, teacher, and grade. There's no account to create and nothing to download.",
        points: [
          "Register up to eight children and five other adults in one go, and each adult is checked in separately at the door",
          "Already have a list of families? Import it from a spreadsheet, and email each family their confirmation if you like",
          "Download a QR code for flyers, newsletters, and slides",
          "Close registration by hand, or set a date and time for it to close on its own",
        ],
        screen: {
          src: "/screens/parent-register-page.webp",
          alt: "The parent registration page on a phone with the school's logo: the event, its time and place, and the start of the form.",
        },
      },
      {
        title: "Families stay in the loop",
        body: "Parents get a confirmation email with a calendar invite that reminds them to bring a government-issued photo ID, and another reminder the day before.",
        points: [
          "A private link lets parents change or cancel their registration, and their calendar invite updates to match",
          "If a parent registers again with the same email, we email them their link instead of making a second registration",
          "Your logo and colors are on the pages parents see",
        ],
        screen: {
          src: "/screens/parent-manage-registration.webp",
          alt: "A parent's own registration page on a phone: the lunch, who's coming, each child, calendar links, and a photo ID reminder.",
        },
      },
      {
        title: "Know who's coming",
        body: "Your event page shows how many families have registered, how many adults are coming, how many children, and how many families registered this week.",
        points: [
          "Children counted by grade and by teacher, for planning seating, food, and class coverage",
          "On the day, see how many adults have checked in, how many are still to arrive, and how many families are here, updated on its own",
          "Only counts appear there: children's names stay on the door list",
        ],
        screen: {
          src: "/screens/parent-registration-numbers.webp",
          alt: "The Parent registration card on a phone: 46 families, 70 adults coming, 63 children, 9 new this week, and children by grade and by teacher.",
        },
      },
      {
        title: "Check-in at the door",
        body: "Your team checks off each adult at the door with one tap, on any phone, tablet, or laptop. On the day, a Check in parents button takes them straight to the list.",
        points: [
          "Search by any adult's or child's name, a teacher, an email, or a phone number",
          "See how many adults have checked in out of how many registered, updated on its own, for planning seating or food",
          "Undo a wrong tap, with a confirmation first",
          "Your staff still checks each photo ID in person",
        ],
        screen: {
          src: "/screens/parent-door-search.webp",
          alt: "Door check-in on a phone: a search for a child's name, how many adults are checked in, and a Check in button for each adult.",
        },
      },
      {
        title: "The rest of the day",
        body: "The same event can take volunteer sign-ups for lunch helpers, greeters, or setup, and share news with families on its public page.",
        points: [
          "Volunteers sign up for shifts without making an account, and get a reminder the day before",
          "Post a banner for a late start or a room change",
          "Share a campus map or parking notes with everyone",
        ],
      },
    ],
    steps: [
      {
        title: "Open registration",
        body: "Share one link or QR code, and close registration whenever you're ready.",
        screen: "/screens/parent-registration-setup.webp",
        alt: "The organizer's Parent Registration page: registration open, and the door check-in list below.",
      },
      {
        title: "Parents register",
        body: "Each parent adds their children, teachers, and grades, and agrees to bring a photo ID.",
        screen: "/screens/parent-registration-form.webp",
        alt: "A parent registering for a family lunch: their name, email, and phone, then their child.",
      },
      {
        title: "Check adults in at the door",
        body: "Find the family, check each adult's photo ID, and tap Check in.",
        screen: "/screens/parent-door-checkin.webp",
        alt: "Door check-in: a family's children and adults, with a Check in button for each adult.",
      },
    ],
    privacy: [
      "Only your event team sees children's names, teachers, and grades, and Coordinators see them only on event day.",
      "Every registration, including children's details, is deleted 30 days after the event.",
      "Parents never make an account.",
      "No ads, no spam, and emails used only for your event",
    ],
    faqs: [
      {
        q: "Can we use this instead of an online form for parent check-in?",
        a: "Yes. Parents register ahead with each child's name, teacher, and grade, get a reminder to bring a photo ID, and your front office checks every adult in at the door on any device. Unlike a form spreadsheet, children's details are seen only by your event team and are deleted 30 days after the event.",
      },
      {
        q: "Do parents need an account or an app?",
        a: "No. Parents register from a link or QR code in their phone's web browser, and get a private link to see, change, or cancel their registration.",
      },
      {
        q: "Does it check photo IDs?",
        a: "Your staff checks each photo ID at the door, as they do today. Parents are reminded to bring one in their calendar invite and in an email the day before, so fewer arrive without it.",
      },
      {
        q: "Who can see children's names?",
        a: "Only your event team. Coordinators see them only on the day of the event, and every registration is deleted 30 days after the event.",
      },
      {
        q: "Can walk-ins still come?",
        a: "That's up to you. You can show a “walk-ins welcome” notice on the registration page once registration closes. Walk-ins aren't added to the door list: your staff signs them in through your school's usual visitor process.",
      },
      {
        q: "Can we bring in a list of families we already have?",
        a: "Yes. Import a spreadsheet with each parent's name and email, and each child's name, teacher, and grade. A mobile number and other adults are optional. You can email each family a confirmation with their private link, or add them without emailing.",
      },
      {
        q: "What if a parent registers twice?",
        a: "Registering again with the same email doesn't make a second registration. We email that parent their private link, where they can change or cancel what they sent.",
      },
    ],
  },
} satisfies Record<string, Audience>;

/** In the order of the home page's event-type cards. */
/** Parent-teacher conferences have their own page (free for teachers during the pilot, so no pilot form). */
/** For principals and district staff (not an event type, so it has its own page). */
export const ADMINISTRATORS_PAGE = { path: "/school-administrators", name: "For administrators", icon: "building" } as const;

/** How student and family data is handled, for district technology and legal teams. */
export const STUDENT_PRIVACY_PAGE = { path: "/student-data-privacy", name: "Data privacy", icon: "lock" } as const;

export const CONFERENCES_PAGE = { path: "/parent-teacher-conferences", name: "Parent-teacher conferences", icon: "apple" } as const;

/** Meetings: office hours and appointments anyone can book (not a school-event audience, so its own page). */
export const MEETINGS_PAGE = { path: "/meetings", name: "Meetings", icon: "calendar" } as const;

export const AUDIENCES: Audience[] = [audiences.volunteers, audiences.bands, audiences.groups, audiences.fairs, audiences.parents];
