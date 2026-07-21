# The Datalevin Detective — Case Bible

**INTERNAL DESIGN DOC. Every spoiler in the game. Never ships to players.**

Working title: *The Low Tide Killings? No —* ***Dead Reckoning at Port Marlowe***.

Medium: a `.dtlvnb` notebook (the case file) plus a seed database (`port-marlowe`).
The player's notebook *is* the investigation: prose narration, query cells as
evidence pulls, chart cells as the corkboard, and — the signature mechanic —
**interviews are transacts**. The case db ships with public records only;
testimony enters the db because the player writes it there.

---

## 1. Premise

Port Marlowe: a foggy harbor town, one cannery, one bar, one church, ~40 souls
in the database.

**Victim:** Vera Quill, 58, investigative journalist. Co-host (with June
Okafor) of *The Low Tide*, a true-crime podcast that just landed a real
sponsorship. Vera was two weeks from publishing an exposé on Dorian Slate's
development deal for the cannery — and one week from leaving the podcast to
go solo, taking the show and the sponsorship with her.

**Found:** Thursday, 10:05pm, at the end of Pier 3 (the cannery's pier), by
the night watchman. Stabbed with a cannery oyster-shucking knife.

**Killer:** **June Okafor**, her editor and co-host.

**Why:** Vera walking away kills the podcast. June had secretly borrowed
against the business, and the show's only sponsor — HarborLight Brewing — is
owned by Slate Holdings. If Vera's exposé sinks the cannery deal, Slate pulls
the sponsorship; if Vera leaves, June loses the show anyway. Vera is an
existential threat coming from two directions at once.

---

## 2. The Cast

| Person | Role | Means | Motive | Opportunity | Fate |
|---|---|---|---|---|---|
| Vera Quill | victim | — | — | — | dead |
| **June Okafor** | editor, co-host | ✓ vendor badge | ✓ losing show + debt | ✓ no alibi, at gate 8:32 | **KILLER** |
| Dorian Slate | developer | ✗ never badged in | ✓ exposé kills his deal | ✗ in the city, 50 mi | herring #1 (ch 2) |
| Marla Quill | sister, shopkeeper | ✗ no access | ✓ inherits everything | ✓ initially none | herring: cleared ch 7 |
| Bex Calloway | cannery foreman | ✓ staff | ✗ (looks ✓: public feud) | ✓ on shift till 8:45 | herring: town's favorite suspect |
| Nico Farr | fisherman, the ex | ✗ own knives, no badge | ✓ bitter, outed by Vera | ✓ "alone at sea" | herring: cleared ch 7 |
| Ernie Pudd | town drunk | ✗ | ✗ | ✗ in the drunk tank | the false confession (ch 5) |

Design rule: **every herring holds exactly 2 of 3 MMO columns at the moment
they become suspected; the killer holds all 3.** The suspect matrix cell is
the scoreboard — re-run it after every chapter and watch columns flip.

Noise: ~30 additional townsfolk with jobs, accounts, badges, purchases,
statements and events, so filters genuinely filter.

---

## 3. Ground-Truth Timeline (Thursday)

| Time | Event | Data where |
|---|---|---|
| 7:00pm | Vera leaves her office | door log |
| 7:15 | Vera's car through the harbor toll | toll event |
| 7:00 (claimed 9:00) | June's 4-min call with the sponsor | phone records (ch 7 transact) |
| 8:30 | Vera texts June: "Meet me at the cannery 8:30, bring the archive drive." June *does* come. | Vera's message log |
| 8:32 | June's vendor badge at the cannery gate | badge log |
| 8:45 | Bex checks out of her shift | gate log |
| 8:50 | Argument heard near the gate; witness sees "a woman in a green raincoat" | witness statements (ch 5/6) |
| 8:52 | Bex's car through the north toll, away from pier | toll event |
| ~8:55–9:10 | **The murder.** | — |
| 9:05 | Bex's home door sensor | sensor event |
| 9:15 | **Vera's standing Thursday pharmacy pickup never happens** | *absence* — ch 6 |
| 9:20 | Nico's bar tab opens at the Tidewater | tab event |
| 9:40 | June's phone pings the *harbor* tower; she claims she was home | phone records (ch 7) |
| 10:05 | Night watchman finds the body | incident report |
| Fri 8:00am | Police announce: "a bladed weapon, type undetermined" | announcement record |
| Fri | **Ernie Pudd confesses.** Says midnight. Says Pier 5. | ch 5 transact |

---

## 4. The Lie Ledger

Every lie is planted as data, and every lie is exposed by a query. This is the
game's contract with the player: *you never have to believe anyone.*

| Who | Claims | Truth | Exposed by | Chapter |
|---|---|---|---|---|
| Dorian | "Just a routine business trip" | wired $250k to a shell — a bribe to the building inspector, *not* a hitman | aggregate outlier (ch 2), then toll/dinner records clear him of the murder | 2 |
| Bex | "Vera and I were fine" | public screaming match last week | statement fulltext | 3/5 |
| Bex | (the town's theory) | she stood to gain *nothing* — no contact, no payments from Slate | recursive web shows zero 2-hop path Bex→Slate | 4 |
| June | "I hadn't been to the cannery in weeks" | vendor badge log: weekly visits, incl. 8:32 that night | badge query | 5 (House beat) |
| June | "Home writing all evening; on the sponsor call 9–9:30" | call was 7pm, 4 minutes; phone pings harbor tower 9:40 | phone records transact + timeline chart | 7 |
| June | — | owns a pine-green raincoat, bought last month | purchase records + vector-matched witness statement | 6 |
| June | — | says **"that oyster knife"** in her interview, before the weapon type was ever public | fulltext `knife` over statements + timestamps vs the 8am announcement | 5 (Fletcher beat) |
| Ernie | "I killed her, midnight, Pier 5" | drunk-tank log till 9:50; Vera dead by ~9:15; vector drift between his story and scene facts is enormous | absence clue + vec-neighbors | 5→6 |
| Nico | "Out fishing alone, no idea what happened" | actually at the Tidewater by 9:20 | bar tab + boat telemetry | 7 |
| Marla | "I have no idea who'd do this" (implied shadiness) | shop sensor: closed up 8:55–9:20, 25 min away | timeline | 7 |

---

## 5. The MMO Rule (the finale)

```clojure
[(means ?p)       ;; recent cannery badge OR cannery staff
 (motive ?p)      ;; financial entanglement with Vera (contracts, insurance,
                  ;; inheritance, debts) — found via pull/recursion, not gossip
 (opportunity ?p) ;; no verified location away from the harbor, 8:30–9:15
 ]
=> exactly one row: June Okafor
```

The matrix cell renders every person-of-interest with ✓ / ✗ / ? per column.
It is deliberately re-runnable: the player watches it fill in, and learns that
a query result is a *function of the data you have* — transact new evidence,
the matrix changes. Ernie's row is the lesson: a confession column that says
"yes" and three columns that say ✗.

Solution-check query ships in the epilogue: it returns `:case/closed` only if
the accusation transact names June.

---

## 6. Chapters

Each chapter opens with its dictum as the epigraph, teaches one capability,
and ends with a **door question** the player must answer to proceed.
Clue taxonomy drilled throughout (the Columbo triad): every clue is
**missing** (should be there, isn't), **extra** (there, shouldn't be), or
**doesn't fit** (there, but wrong).

### Prologue — the case file opens
Seed db, connect, pull the incident report. First transact of the game:
the player creates their own `:detective` entity. *You are in the database now.*
**Teaches:** connecting, `:find`, first `:tx-data`.

### 1. "It is a capital mistake to theorize before one has data." — Holmes
**Canvas.** Everyone whose records put them near the harbor, 8–10pm Thursday.
Patterns, predicates, time-window filters. Output: 8 persons of interest
(suspects + noise). The matrix appears with all `?`.
**Teaches:** data patterns, filters. **Door:** name the 8.

### 2. "It's never lupus." — House
**The ledger.** Aggregates over the week's transactions: sums, averages,
counts. One screaming outlier: Dorian's $250k wire to a shell. Looks like a
murder. It *is* a crime — a bribe to the building inspector — but toll and
dinner records put Dorian 50 miles away. First clearance; first matrix flips
(Dorian: motive ✓, opportunity ✗). First taste of the triad: the wire was
**extra**.
**Teaches:** aggregates. **Door:** who moved the money, and where was he?

### 3. "The little grey cells." — Poirot
**The dossiers.** One nested pull per suspect: person + accounts + contracts +
badge + statements, whole file in one query. Then Poirot's method made literal:
the *same* parameterized dossier query re-run with `:args` for every suspect —
ask everyone the same question. June's file shows the sponsorship contract
(her name only via the podcast) and a vendor badge she never mentioned.
Marla's shows the inheritance. **Teaches:** pull, nested refs, parameters.
**Door:** whose contract depends on the deal Vera would kill?

### 4. The web — rules and recursion
Epigraph: a spider-and-web line (see notes). Recursive `(connected ?a ?b)`
rule over `:knows` / `:employs` / `:owns` / `:related-to`, with reverse refs.
Everyone within 2 hops of Vera. Two payoffs: (a) HarborLight Brewing → Slate
Holdings → Dorian: June's lifeline *is* the deal — motive sharpens to ✓;
(b) no path of any kind from Bex to Slate: the town's theory has no web.
**Teaches:** rules, recursion, reverse refs. **Door:** who is 2 hops from Vera
through the *sponsor*?

### 5. "Everybody lies." — House
**Interviews are transacts.** The player conducts the interviews: each cell
writes statement entities (`:stmt/text` is fulltext-enabled, embeddings ship
pre-computed). This is the chapter that teaches `:tx-data` by making the
player *do* the investigation. Two beats:
- **Fletcher's guilty knowledge:** fulltext `knife` over statements, joined
  against timestamps. Police announced only "a bladed weapon" at 8am. June's
  interview says "that oyster knife." Extra word, wrong knowledge.
- **The confession lands:** Ernie Pudd's confession is transacted in by the
  police. Fulltext loves it ("killed her on the pier with the knife").
  The matrix does not. Cliffhanger: did the case just close?
**Teaches:** transacts, fulltext, timestamps as data. **Door:** who knew the
weapon?

### 6. "The dog did nothing in the night-time." — Holmes (Silver Blaze)
**The semantic chapter.**
- *Absence:* Vera's standing Thursday 9:15 pharmacy pickup never happened →
  she was dead or dying by 9:15. Time-of-death window snaps to 8:30–9:15 →
  Ernie's "midnight" is impossible. The confession dies of an absence.
- *Semantic:* witness #7 said "a nervous woman loitering by the gate."
  Witness #12 said "a lady in a slicker the color of pine, shouting."
  `vec-neighbors` on one finds the other — same event, no shared words.
  Corroboration without keywords. Then a purchase pull: June bought a
  pine-green raincoat last month.
- Optional garnish: vector drift between Ernie's confession and the
  scene-fact statements is the largest in the db — math says he's describing
  a scene he never saw.
**Teaches:** `vec-neighbors`, `not`-joins / absence. **Door:** what time did
Vera die, and how do you know?

### 7. "It's a blessing. And a curse." — Monk
**The corkboard.** Charts: gate logs, tolls, tabs, sensors, tower pings as a
timeline (bar/point over hours). Now transact in the phone records the
warrant just delivered. The anomalies surface one by one: June's "9pm sponsor
call" was at 7pm and lasted 4 minutes; her phone pinged the *harbor* tower at
9:40 while she claims to be home. The same chart *exonerates*: Nico's tab at
9:20, Marla's shop sensor 8:55–9:20, Bex's 8:52 toll and 9:05 home sensor.
Queries don't just convict — they clear. **Teaches:** `:order-by`, charts,
anomaly framing. **Door:** whose evening doesn't fit?

### 8. "When you have eliminated the impossible..." — Holmes
**The accusation.** Compose the chapter rules into the killer rule. One query
returns exactly one name. Epilogue: the player transacts the arrest —
`[:db/add case :case/status :case/closed]` — and the solution-check confirms.
The notebook, prose to charts to verdict, is now a complete case file.
**Teaches:** composition; everything.

---

## 7. Data Model Sketch (for the seed db)

Entity types (attrs kebab-cased, namespaced):

- `:person/*` — name, role, `:person/knows` (refs), `:person/related-to` (refs)
- `:txn/*` — from, to, amount, ts (accounts as entities)
- `:badge/*` — person, location, ts (cannery + gate)
- `:event/*` — person, kind (toll/tab/sensor/tower/door), place, ts
- `:purchase/*` — person, item, ts
- `:stmt/*` — person, ts, `:stmt/text` (**`:db.fulltext/autoDomain true`**),
  `:stmt/embedding` (**pre-computed vector**; one dimension size db-wide,
  set via `:vector-opts {:dimensions N}` — bridge already handles this)
- `:contract/*`, `:policy/*` — financial entanglements (for the motive rule)
- `:case/*`, `:detective/*`, `:note/*` — game state the player writes

Vector embeddings for all statement texts are computed offline at seed time
(small model, e.g. a MiniLM variant) and shipped in the seed data — the game
must work fully offline.

---

## 8. Tone & Craft Notes

- Noir, but warm: fog, gulls, a bar called the Tidewater. The narrator voice
  in markdown cells is the player's own case-notes voice — second person,
  present tense.
- Columbo's "just one more thing" is the running motif: every chapter's final
  cell is labeled exactly that.
- The triad (missing / extra / doesn't-fit) gets named in ch 2 and referenced
  every time a clue lands. By ch 7 the player should be saying it themselves.
- Ernie must be played straight and a little heartbreaking. He confesses to
  things weekly. The math that clears him is also the kindest thing in the game.
- June is never cartoonish. Her interview is warm, helpful, and grieving.
  That's what makes the `knife` fulltext hit land.

## 9. Open Questions for kay

1. Title: *Dead Reckoning at Port Marlowe* vs *The Low Tide* vs your call.
2. 8 chapters + prologue — right size, or fold 2 into 3?
3. Difficulty: door questions with solution cells hidden at the back, or
   pure honor system?
4. Do we also ship a `.dtlv.edn` playground version of each chapter, or is
   this notebook-only (my vote: notebook-only — it's the showcase)?
5. The confession: should disproving Ernie be required (door in ch 6) or a
   bonus "just one more thing" for sharp players?
