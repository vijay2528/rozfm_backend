# My Streak Feature — Complete Guide (Basic → Advanced)

Ye document teen levels mein bata hai: **BASIC** (concept samjho), **INTERMEDIATE** (section-wise implementation), **ADVANCED** (edge cases, security, scaling). Ek naya developer bhi isse top-to-bottom padhke poora feature samajh sakta hai.

---

# PART A — BASIC (Concept samjho, code se pehle)

## A.1 "Streak" hota kya hai (product concept)

Streak ek **motivation mechanism** hai — Duolingo, Spotify Wrapped, gym apps sabme hota hai. Idea simple hai:

> "Agar user lagataar (consecutive) din kaam karta rahe, to usko reward milta hai. Agar ek din bhi miss kare, to streak toot jaati hai (0 se restart)."

Iska maksad hai: **user ko daily app kholne ki aadat (habit) banwana.**

Roz FM ke case mein: "kaam" = **roz 15 minute audio story sunna**.

## A.2 Is feature ke 5 core building blocks

| Term | Matlab |
|---|---|
| **Streak** | Kitne consecutive din se goal complete ho raha hai |
| **Daily Goal** | Har din pura karne wala target (15 min listening) |
| **Energy** | Reward currency — goal/milestone complete karne pe milta hai |
| **Milestone** | Streak ke special checkpoints (3, 7, 15, 30 din) jinpe bada reward milta hai |
| **Shield** | Ek "insurance" — agar ek din miss ho jaye, streak bachane ka tarika |

Baaki sab (calendar, weekly-strip, achievements) **inhi 5 cheezon ko alag-alag visual form mein dikhate hain.**

## A.3 Sabse important basic samajh: "State" vs "Display"

Ye sabse zaroori concept hai jo developer ko confuse kar raha hoga:

- **State** = asli data (database mein kya save hai) — jaise "user ne aaj 8 min suna hai"
- **Display** = user ko screen pe kya dikh raha hai — jaise progress bar 53%

**Rule: Display hamesha State se derive (calculate) hona chahiye. Kabhi Display khud State ban ke save nahi honi chahiye.**

Jo prototype HTML maine pehle explain ki thi, usmein ye rule toot rahi thi — jaise button click karte hi seedha "goal complete" dikha diya jata tha, bina real listening state check kiye. Real app mein hamesha:

```
Real user action (listening) → Server state update (DB) → Display re-calculate → UI refresh
```

Kabhi ye nahi:
```
Button click → Seedha UI change (state update kiye bina)
```

## A.4 High-level data flow (poora system ek nazar mein)

```
[User sunta hai audio] 
        ↓
[App server ko batata hai "itna suna"] (heartbeat API)
        ↓
[Server DB mein listening time save karta hai]
        ↓
[Server check karta hai: goal complete hua kya?]
        ↓ (haan)
[Server streak++ karta hai, energy add karta hai, achievement check karta hai]
        ↓
[App agli baar screen kholta hai to server se fresh data maangta hai]
        ↓
[Saare sections (hero, week, calendar) usi fresh data se render hote hain]
```

Isse yaad rakho: **saara "My Streak" screen sirf ek "viewer" hai. Asli kaam (calculation, verification, reward-giving) hamesha server pe hota hai.**

---

# PART B — INTERMEDIATE (Section-wise implementation)

Ab har UI section ko basic se jodke dekhte hain — kya dikhta hai, kaunsa building-block (A.2) use ho raha hai, aur backend mein kya chahiye.

## B.1 Hero Card (Streak number + Energy + Best Streak)

**Building blocks used:** Streak + Energy

**Kya dikhana hai:** `current_streak`, `best_streak`, `energy_balance`, `this_month_days`

**DB table — `user_streak_stats`:**
| column | type | kaam |
|---|---|---|
| user_id | FK | konsa user |
| current_streak | int | abhi ka streak |
| best_streak | int | sabse zyada streak kabhi |
| energy_balance | int | wallet |
| last_active_date | date | pichli baar goal kab complete hua |

**API:** `GET /user/streak-summary`

**Kaam kaise karta hai (flow):**
1. Screen open → is API ko call karo
2. Response se 4 numbers hero card mein bhar do
3. Bas — ye sirf **read** hai, yahan koi calculation nahi hoti (calculation Section B.2 mein hoti hai, jab goal complete hota hai)

## B.2 Today's Listening Goal (progress bar)

**Building blocks used:** Daily Goal

**Kya dikhana hai:** "11 of 15 min", progress %, "CONTINUE LISTENING" button

**DB table — `daily_listening_log`:**
| column | type |
|---|---|
| user_id | FK |
| date | date |
| listened_seconds | int |
| goal_completed | bool |
| reward_claimed | bool |

**APIs:**
- `POST /listening/heartbeat` — player chalte waqt har 15-30 second mein call, body: `{seconds:15}`
- `GET /listening/today-status` — progress bar ke liye
- `POST /rewards/claim-daily` — CLAIM button pe

**Kaam kaise karta hai (step-by-step):**
1. User audio player kholta hai, sunna shuru karta hai
2. Har heartbeat pe server `listened_seconds` mein add karta hai (DB update)
3. Server check karta hai: `listened_seconds >= daily_goal_seconds (900)` ?
4. Agar haan → `goal_completed = true` set karta hai
5. **YAHI POINT PE STREAK BADHTA HAI** (B.1 ka `current_streak` yahin se update hota hai):
   ```
   agar last_active_date == yesterday:
       current_streak += 1
   agar last_active_date == today (already updated):
       kuch mat karo
   agar last_active_date < yesterday (gap tha) aur koi shield nahi lagaya:
       current_streak = 1  (restart)
   last_active_date = today
   best_streak = max(best_streak, current_streak)
   ```
6. User "CLAIM REWARD" dabata hai → server `reward_claimed=false` check karke `energy_balance += 5` karta hai, `reward_claimed=true` set karta hai

**Basic se advance ka connection:** Yahi wo jagah hai jahan Part A.3 ka rule (State vs Display) sabse zyada matter karta hai — goal complete "button-click" se nahi, **"real listened_seconds"** se hona chahiye.

## B.3 This Week Strip

**Building blocks used:** Daily Goal (history ke roop mein)

**Ye "naya" data nahi hai** — sirf `daily_listening_log` table ke pichle 7 din ke rows ko ek strip mein dikhana hai.

**API:** `GET /user/weekly-activity`

**Kaam kaise karta hai:**
- Server "is week" (Mon-Sun, server ki real date se) ke 7 din nikalta hai
- Har din: `goal_completed=true` → "done", `date==today` → "today", `date<today aur goal_completed=false` → "missed", `date>today` → "upcoming"
- Ye **pure calculation** hai, koi naya table nahi chahiye

## B.4 Next Reward + Streak Journey (Milestones)

**Building blocks used:** Milestone

**DB tables:**
- `streak_milestones` (admin-configured, ek baar banta hai): `days_required, energy_reward, title`
- `user_milestone_claims` (per user): `user_id, milestone_id, claimed_at`

**APIs:**
- `GET /streak/next-milestone` — agla unclaimed milestone + progress %
- `GET /streak/milestones` — saare milestones ka status
- `POST /rewards/claim-milestone` — claim button

**Kaam kaise karta hai:**
1. Server `current_streak` ko `streak_milestones.days_required` se compare karta hai
2. Jo sabse pehla unclaimed milestone hai jiske liye `current_streak >= days_required`, wo "claimable" hai
3. Claim pe: `user_milestone_claims` mein ek row insert (agar already row hai → error "already claimed")
4. `energy_balance += milestone.energy_reward`

**Duplicate-claim protection (important):** Row ka insert hi "claimed" ka proof hai — koi simple `true/false` flag kaafi nahi hai, kyunki agar do requests ek saath aayein (double-click) to dono ek jaisa flag dekh ke dono energy de sakte hain. Database mein **unique constraint** lagao: `UNIQUE(user_id, milestone_id)` — isse dusri request automatically fail ho jayegi.

## B.5 Activity Calendar (month view)

**Building blocks used:** Daily Goal (history) + Shield

**Ye bhi "naya" data nahi hai** — B.2 ke `daily_listening_log` + Shield ke `protected_days` (B.6) ko merge karke ek mahine ka grid banata hai.

**API:** `GET /user/streak-calendar?month=9&year=2026`

**Kaam kaise karta hai:**
```
har date d is month mein:
  agar d > today: "upcoming"
  agar d == today: "today"
  agar d < today:
    agar daily_listening_log[d].goal_completed == true: "completed"
    agar protected_days mein d hai: "protected"
    warna: "missed"
```

## B.6 Streak Shield

**Building blocks used:** Shield

**DB tables:**
- `user_shield_stats`: `user_id, shield_count, earn_progress, max_stored`
- `protected_days`: `user_id, date`

**APIs:**
- `GET /streak/shield-status`
- `POST /streak/protect-day` (body: `{date}`)

**Kaam kaise karta hai (do alag flows):**

**Flow 1 — Shield kamana (earning):**
```
har baar goal_completed hota hai:
  earn_progress += 1
  agar earn_progress >= 7 (successful_days_required):
    agar shield_count < max_stored (2):
      shield_count += 1
    earn_progress = 0
```

**Flow 2 — Shield use karna (missed day pe):**
```
user missed date pe "USE SHIELD" dabata hai
  server check: shield_count > 0 ?
  agar haan:
    protected_days mein (user_id, date) insert karo
    shield_count -= 1
    ye date ab "missed" nahi, "protected" ginegi (B.1 ke streak-reset logic mein bhi ye skip honi chahiye)
```

**Zaroori link:** B.2 ke streak-reset logic (`current_streak = 1` agar gap hai) mein ye check bhi hona chahiye: *"agar wo gap-wali date `protected_days` mein hai, to reset mat karo."*

## B.7 Achievements

**Building blocks used:** Streak (thresholds)

**DB tables:**
- `achievements`: `id, title, threshold_days`
- `user_achievements`: `user_id, achievement_id, unlocked_at`

**API:** `GET /user/achievements`

**Kaam kaise karta hai:** Passive — jab bhi `current_streak` update hota hai (B.2 ke step 5 ke baad), server ek check chalaye: `current_streak >= achievement.threshold_days aur already unlock nahi hai` → `user_achievements` mein insert. Koi claim button nahi, ye khud-b-khud unlock hota hai.

## B.8 FAQ Section

Koi backend nahi chahiye — static content (CMS se optional).

---

# PART C — ADVANCED (Edge cases, security, scaling)

Ab jab basic + intermediate clear ho gaya, ye woh cheezein hain jo **production mein bugs se bachati hain.**

## C.1 Race Conditions (do requests ek saath aana)

**Problem:** User "CLAIM" button do baar tez-tez dabaye (ya network retry ho), to dono requests ek saath server pe pahunch sakti hain.

**Solution:**
- Database level pe **unique constraint** (jaise B.4 mein bataya)
- Ya **row-level locking** (`SELECT ... FOR UPDATE`) claim-transaction ke dauran
- Idempotency key bhejna client se bhi ek achha practice hai (`POST /rewards/claim-daily` with `Idempotency-Key: <uuid>`)

## C.2 Timezone Handling

**Problem:** "Aaj ka din" kis timezone mein calculate ho? Agar user Mumbai mein hai aur server UTC mein chal raha hai, to raat 12 baje ke aas-paas "today" ka calculation galat ho sakta hai.

**Solution:**
- User ka timezone store karo (`user.timezone`, jaise "Asia/Kolkata")
- Server "today" calculate karte waqt hamesha **user ke timezone** mein convert kare, UTC mein nahi
- Streak-reset cron job bhi user ke local midnight ke hisaab se chalna chahiye (ya ek global check jo query-time pe calculate kare, cron pe depend na kare)

## C.3 Streak-Break Detection — Cron vs On-Demand

Do tareeke hain streak reset detect karne ke:

1. **Cron job (daily, midnight)** — har user ko check kare: agar `last_active_date < yesterday` aur no shield → `current_streak = 0`
   - Pro: Data hamesha "fresh" rehta hai
   - Con: Scale hone pe lakhon users pe daily cron heavy ho sakta hai

2. **On-demand (jab bhi user screen khole)** — API call ke time hi check kar lo ki streak break hui ya nahi, tabhi UI ko sahi number do (DB ko turant update mat karo, sirf response mein "effective streak" bhejo, background job se baad mein confirm kar lo)
   - Pro: Lightweight, sirf active users ke liye kaam hota hai
   - Con: Thoda zyada complex logic har GET request mein

**Recommendation:** Chhoti/medium app ke liye **cron approach** simple aur safe hai. Scale badhne pe hybrid (cron + on-demand fallback) use karo.

## C.4 Client-side Cheating Prevention

**Kya-kya cheat kiya ja sakta hai (agar galat design ho):**
- Direct localStorage edit karke energy badha lena → **Solution:** energy_balance hamesha server-verified, localStorage sirf display-cache
- Heartbeat API ko fake spam karna (bina actual sunte hue) → **Solution:** server-side sanity check — ek heartbeat max 30 sec tak hi count kare, aur agar consecutive heartbeats bahut zyada tez aa rahe hain (bot jaisa) to rate-limit/flag karo
- Claim API ko baar-baar call karna → **Solution:** C.1 wali unique constraint

## C.5 Caching & Performance (scaling ke liye)

- `streak_milestones` aur `achievements` tables **rarely change** — inhe Redis/in-memory cache mein rakho, har request pe DB hit mat karo
- `user_streak_stats` (hero card data) **frequently read** hota hai — agar app bada hai, to is table ko bhi cache karo (with short TTL, ya cache-invalidate on write)
- `daily_listening_log` pe **index** lagao `(user_id, date)` pe — calendar aur weekly-strip dono is index se fast query karenge

## C.6 Testing Checklist (QA ke liye)

| Test Case | Expected |
|---|---|
| User 15 min se kam sune | goal_completed=false, streak na badhe |
| User exactly 15 min sune | goal_completed=true, streak+1 |
| User 2 din gap ke baad aaye (no shield) | streak reset to 1 |
| User 2 din gap, ek din shield-protected | streak break na ho |
| Claim button 2 baar tez dabaya | energy sirf ek baar mile |
| Milestone already claimed, phir se claim try kare | error/blocked |
| Shield count 0 ho, phir bhi use karne ki try | error "no shield available" |
| Midnight ke aas-paas (11:58pm-12:02am) goal complete kare | sahi din ko credit mile (timezone-safe) |
| Achievement threshold cross ho lekin app band ho | agli baar khole to achievement already unlocked dikhe |

---

# Quick Summary (agar sirf ek cheez yaad rakhni ho)

> **Frontend sirf display hai. Har number (streak, energy, milestone status) server pe calculate/verify hota hai, database mein store hota hai, aur idempotent (duplicate-safe) tarike se update hota hai. Client ki date/click par kabhi bharosa mat karo — sirf server ki date aur server-verified actions par bharosa karo.**
