// Fixed set of profile inputs for scripts/eval-models.mjs. All profiles are synthetic
// (fictional names/handles) — none reference real people. Formatted to match exactly
// what scrapeGithub / scrapeLinkedIn / scrapeInstagram produce in api/roast.js, so the
// eval sees the same shape of input the models see in production.

export const FIXTURES = [
  {
    id: "github-mild",
    type: "github",
    severity: "mild",
    profileText: `GitHub Profile: Alex Chen
Username: alexc-dev
Bio: No bio provided
Location: Unknown
Followers: 3
Following: 41
Public repos: 6
Account created: 1/12/2024
Top 10 repositories:
1. todo-app | Stars: 0 | Forks: 0 | Language: JavaScript | Description: No description
2. todo-app-v2 | Stars: 0 | Forks: 0 | Language: JavaScript | Description: No description
3. portfolio | Stars: 1 | Forks: 0 | Language: HTML | Description: my portfolio site
4. leetcode-solutions | Stars: 0 | Forks: 0 | Language: Python | Description: No description
5. hello-world | Stars: 0 | Forks: 0 | Language: JavaScript | Description: No description
6. weather-app-tutorial | Stars: 0 | Forks: 1 | Language: JavaScript | Description: Following a YouTube tutorial`,
  },
  {
    id: "github-destroy-me",
    type: "github",
    severity: "destroy me",
    profileText: `GitHub Profile: Jordan Patel
Username: jpatel-builds
Bio: 10x engineer | building in public | DM for collabs
Location: Remote
Followers: 812
Following: 1904
Public repos: 143
Account created: 3/2/2019
Top 10 repositories:
1. awesome-ai-tools | Stars: 412 | Forks: 89 | Language: Markdown | Description: A curated list (forked, unedited since fork)
2. saas-boilerplate-2023 | Stars: 5 | Forks: 0 | Language: TypeScript | Description: Started this, never finished
3. saas-boilerplate-2024 | Stars: 2 | Forks: 0 | Language: TypeScript | Description: Restarting the boilerplate idea
4. crypto-trading-bot | Stars: 18 | Forks: 3 | Language: Python | Description: WIP, do not use in production
5. personal-site-v4 | Stars: 0 | Forks: 0 | Language: JavaScript | Description: rebuilding again
6. personal-site-v5 | Stars: 0 | Forks: 0 | Language: Astro | Description: rebuilding again (for real this time)
7. gpt-wrapper-startup-idea | Stars: 1 | Forks: 0 | Language: TypeScript | Description: No description
8. gpt-wrapper-startup-idea-v2 | Stars: 0 | Forks: 0 | Language: TypeScript | Description: pivoted
9. leetcode-daily | Stars: 0 | Forks: 0 | Language: Python | Description: Day 4 of 100 (last commit 8 months ago)
10. fork-of-react | Stars: 0 | Forks: 0 | Language: JavaScript | Description: No description`,
  },
  {
    id: "linkedin-medium",
    type: "linkedin",
    severity: "medium",
    profileText: `Full name: Morgan Ellis
Headline: Passionate Growth Strategist | Synergizing Cross-Functional Teams | Thought Leader
Location: Austin, TX
About: I am a results-driven, passionate professional dedicated to synergizing high-impact initiatives that move the needle. My journey has been defined by a relentless commitment to excellence and disrupting the status quo. Let's connect and unlock new possibilities together!
Current company: BrightPath Growth Collective
Current role: Senior Director of Strategic Synergy
Followers: 6204
Connections: 500+
Top 3 work experiences:
1. BrightPath Growth Collective | Senior Director of Strategic Synergy | Jan 2023 - Present
2. Momentum Digital Partners | Growth Marketing Lead | Jun 2020 - Dec 2022
3. Nimbus Ventures | Marketing Coordinator | Aug 2018 - May 2020
Education:
1. University of Texas at Austin | BA | Communications
Top skills:
1. Thought Leadership
2. Synergy
3. Cross-Functional Collaboration
4. Growth Hacking
5. Personal Branding`,
  },
  {
    id: "linkedin-destroy-me",
    type: "linkedin",
    severity: "destroy me",
    profileText: `Full name: Devon Marsh
Headline: 🚀 Serial Entrepreneur | Building the Future of Web3 AI | 3x Founder | Forbes 30 Under 30 Nominee (self-nominated)
Location: San Francisco Bay Area
About: They said it couldn't be done. I did it anyway. From dropping out to building a 7-figure agency to now revolutionizing the intersection of AI and blockchain — my story is one of relentless hustle. I don't chase trends, I set them. DM me "GROWTH" for a free 15-minute strategy call (spots limited).
Current company: Stealth Mode
Current role: Founder & Visionary
Followers: 41209
Connections: 500+
Top 3 work experiences:
1. Stealth Mode | Founder & Visionary | Feb 2024 - Present
2. GrowthNinjaz Agency | Founder & CEO | Sep 2021 - Jan 2024
3. Self-Employed | Full-Time Hustler | Jan 2020 - Aug 2021
Education:
1. University of Life | Honorary Degree | Hustling
Top skills:
1. Visionary Leadership
2. Web3
3. Personal Branding
4. Public Speaking
5. Growth Hacking
6. AI Strategy
7. Networking`,
  },
  {
    id: "instagram-mild",
    type: "instagram",
    severity: "mild",
    profileText: `Username: sunsetsandmatcha
Full name: Riley Tanaka
Bio: 🌿 slow living | matcha enthusiast | photos from my little corner of the world
Followers: 2140
Following: 890
Posts count: 214
Is verified: False
Latest 5 post captions:
1. golden hour hits different today
2. new matcha spot unlocked ☕️
3. sunday reset
4. this view though
5. small moments > big plans`,
  },
  {
    id: "instagram-medium",
    type: "instagram",
    severity: "medium",
    profileText: `Username: grindneverstops__
Full name: Casey Brooks
Bio: 💪 5AM CLUB | Mindset > Motivation | Coaching link below 👇 | #hustle
Followers: 18400
Following: 4102
Posts count: 1893
Is verified: False
Latest 5 post captions:
1. while you were sleeping I was GRINDING 💪🔥
2. no days off. link in bio for my free ebook
3. success is a mindset. tag someone who needs to hear this
4. gym at 4:45am hits different when you're built different
5. mindset check: are you doing the work or making excuses?`,
  },
  {
    id: "resume-medium",
    type: "resume",
    severity: "medium",
    profileText: `SAM RIVERA
Objective: Seeking a challenging position at a dynamic company where I can utilize my skills and grow professionally while contributing to team success and organizational goals.

EXPERIENCE

Junior Associate — Whatever Corp
2022-Present
- Did tasks assigned by manager
- Worked in a team environment
- Used Microsoft Excel and Word on a daily basis
- Helped with various projects as needed
- Attended meetings

Intern — Some Startup Inc
Summer 2021
Responsible for: coffee runs, note-taking in meetings, data entry, other duties as assigned by supervisor, filing, scheduling, misc administrative support tasks that came up during the course of the internship

SKILLS
Microsoft Office, Team Player, Hard Worker, Fast Learner, Detail-Oriented, Communication, Leadership, Problem Solving, Time Management, Multitasking

EDUCATION
State University, BA General Studies, 2021
GPA available upon request`,
  },
  {
    id: "resume-destroy-me",
    type: "resume",
    severity: "destroy me",
    profileText: `TAYLOR QUINN
"Synergistic Value-Driven Professional"

PROFESSIONAL SUMMARY:
Highly motivated self-starter with a proven track record of leveraging synergies to drive paradigm shifts across cross-functional matrixed organizations. Passionate about disrupting legacy thinking through innovative ideation frameworks.

CORE COMPETENCIES:
Synergy | Paradigm Shifts | Disruption | Innovation | Thought Leadership | Value-Add | Circling Back | Bandwidth | Low-Hanging Fruit | Boiling the Ocean | Moving the Needle

EXPERIENCE:

Chief Vision Officer, Self-Employed (2023-Present)
- Spearheaded a personal brand pivot into the AI-blockchain-Web3 convergence space
- Ideated on several ground-up concepts that have not yet launched
- Circled back with key stakeholders (family members) regarding runway extension

Growth Evangelist, TrendChasers LLC (2021-2023)
- Owned the end-to-end evangelism lifecycle for products that were later discontinued
- Boiled the ocean on a rebrand that was shelved after two weeks
- Left to "pursue other opportunities" (company folded one month later)

EDUCATION:
Bachelor of Synergy Studies, Buzzword University, incomplete (3.5 years of a 4-year program)

Note: Full resume available as a 40-slide Canva deck upon request.`,
  },
];
