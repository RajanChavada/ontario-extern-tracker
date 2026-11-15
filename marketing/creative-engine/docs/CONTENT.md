# Content strategy for marketing posts (2026-11-14)

Write like a nursing-student creator, not a hospital job board. A post earns the swipe with a student problem and pays it off with something useful. The Ontario posting arrives as the real example, not as the headline.

**Audience:** nursing students, mostly women in nursing school; Ontario and Canada first. Pick topics that also make sense to students elsewhere (externships, talent pools, applying, requirements). Keep the Ontario specifics for the opportunity slide.

**Evidence:** the Growth Ops TikTok research has 61 real posts (2026-11-14). The snapshot is at `workspace/research/raw/tiktok-research-2026-11-14/`, outside this repo: REPORT.md, hooks_captions.md, pain_points.md, CONCEPTS.md and evidence_catalog.csv. Cite post IDs (P0xx) and concept numbers in the brief.

## Structure: hook → relatable → value → opportunity → CTA
Adapt the count to the topic: 5–8 slides, one format per post. Every slide must deliver on the cover's promise.

1. **Hook (cover).** A student problem, a curiosity gap, a question or a practical promise, in ≤12 words. Name the audience or the situation, not the hospital. A short secondary line (≤10 words, `body`) may carry the Ontario callout. If the post is time-sensitive, that line carries the deadline.
2. **Make it relatable.** The situation in plain, second-person student language.
3. **Value (1–2 slides).** What it means, the misconception corrected, what to check, or what to do. It's the payoff someone saves.
4. **Opportunity.** The specific Ontario posting with its verified facts: deadline, eligibility and pay. Talent pools are always labelled as talent pools.
5. **CTA.** It follows from the value. For example, after explaining talent pools, the CTA says the tracker labels them separately. Use ontarioexterns.ca and "Not affiliated with any hospital."

## Hook strategy by post type (`brief.type`)
| type | lead with | evidence |
|---|---|---|
| listing | the student problem (not knowing where or when to apply), then the practical opportunity | pain point 2; P020, P029 |
| deadline | urgency from the real date, never invented scarcity ("spots filling fast") | pain point 2; F4 |
| talent_pool | the misconception: a posting isn't always an open job | CONCEPTS #10; pain point 3; P047 (myth-bust, 626 saves) |
| checklist | saveable utility ("read this before applying") | F1: P032, P022, P060 (saves ≈ likes) |
| explainer | curiosity and misconceptions ("what an extern actually does") | pain point 3; P025, P050 |
| relatable | recognisable experiences and humour, kept short | F3: P051–P055 (shares, not saves) |

## Before choosing the hook
Write 3–8 candidate hooks in `brief.hooks` and pick the one that best fits all of these:
- What problem does this solve for a nursing student? Is there a real payoff by the last slide?
- Would someone who has never heard of the hospital stop scrolling? What makes them swipe to slide 2?
- Does it sound like a student talking, rather than a press release? Lowercase, second person (hooks_captions.md: casing; "speak to a stage").
- Is the Ontario-specific information introduced at the right point, and does the CTA follow from the value?
- Do the slides actually deliver what the hook promises? If not, change the hook, not the facts.

Record the choice in `brief.why`, the payoff in `brief.payoff`, and the research IDs in `brief.evidence`. `oet check` warns when a marketing post has no brief (BRIEF_MISSING) and fails if the cover isn't one of the candidate hooks (BRIEF_HOOK_MISMATCH).

## Honesty (validator-enforced where it can be checked)
- **Voice (decision 9, 2026-11-15).** Posts are either `"voice": "brand"` (the default: second and third person, no first person; FIRST_PERSON_CLAIM, STOCK_FIRST_PERSON) or `"voice": "student"`. In the student voice, the "i" is the real student in the voice profile: the account owner, who runs the tracker and consented on 2026-11-15. Never name the voice in posts, specs, docs or handoffs. The profile lives at `workspace/voice/voice-profile.json`, outside the repo; override it with `OET_VOICE_PROFILE`.
  - **Profile required.** A student-voice post needs the profile with signed consent (VOICE_PROFILE_MISSING, VOICE_CONSENT).
  - **Claims.** First person is fine. Experience claims ("when i applied…", "i'm in third year", "my placement", "i got…") must appear word for word in the profile's `true_statements` (VOICE_UNSUPPORTED_CLAIM). Never fill those in on the student's behalf. Program, year and experience are blank until he adds them.
  - **The link to the tracker.** Wherever ontarioexterns.ca appears, say the link plainly: "the list i help run" or "i run" (VOICE_LINK_UNDISCLOSED).
  - **Photos.** No "i", "me" or "my" over stock photos that show people. Use object or scene photos, or his own photos (STOCK_FIRST_PERSON).
  - **Tone.** Brochure phrasing ("our independent tracker", "have you come across") and semicolons get a warning (VOICE_BROCHURE).
  - **Sign-off.** The voice approves every post. While the voice is also the publishing approver (`approval.same_person_as_publisher`), his Grokbot approval of the exact fingerprint is that sign-off. If the voice is ever someone else, `oet export` refuses student-voice posts (VOICE_SIGNOFF_REQUIRED) until a sign-off step is built.
  - **Examples.** Hook bank and examples: `workspace/creative-reference/oet-hermes-package-2026-11-15/voice-examples.md`. Hooks marked "only if her profile says…" need the matching true statements.
- No invented rejections, outcomes, comments, engagement or testimonials. Never promise that a tactic gets a callback or a job (OUTCOME_CLAIM).
- No hook the slides can't pay off. No "spots filling fast" or other invented scarcity.
- **Every number and date** is a cited fact (UNSUPPORTED_SPECIFIC).
- **Time-sensitive posts** show the closing date on the cover, in the hook or the secondary line, citing the deadline fact (DEADLINE_NOT_ON_COVER).
- **A talent pool is never a vacancy.** Any slide citing a talent pool's deadline or pay says "talent pool", and so does the caption (TALENT_POOL_UNLABELLED).
- **Captions:** state the facts plainly. One question to the viewer is fine (hooks_captions.md: caption patterns). Keep the tracker disclaimer line.

## Reference post (brand voice)
`specs/tracker/shn-talent-pool-explainer.json` (talent_pool type, 7 slides).
