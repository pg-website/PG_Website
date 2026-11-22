# Code Review: Pairing and Rating Logic

**ID:** REVIEW-001  
**Type:** code-review  
**Feature:** FEAT-001  
**Reviewer:** code-reviewer  
**Status:** approved  
**Date:** 2026-11-22

---

## Requirements Status: pass

The pairing and rating implementation meets the functional requirements defined in the architecture and feature specifications. Swiss pairing follows the documented algorithm, Glicko-2 rating calculations match the reference implementation, and tie-break ordering follows the specified precedence.

## Architecture Status: pass

The implementation follows the backend architecture contract:
- Pure functions for pairing engine and tie-breaks (no database, no clock, deterministic)
- Rating processing is idempotent via RatingRun gate
- Transactional consistency maintained throughout
- Web/backend type contracts align correctly

## Testing Status: pass

Comprehensive test coverage exists across all critical paths:
- Pairing engine: 31 test cases covering Swiss, social balanced, byes, colours, rematches
- Tie-breaks: 15 test cases covering Buchholz variants, Sonneborn-Berger, place numbers
- Standings: 13 test cases covering final results only, identity toggles, rating visibility
- Season simulation: 20 players × 10 tournaments × 5 rounds validating end-to-end behavior
- Frontend/backend parity maintained via shared test vectors

## Findings

| ID | Severity | Title | Location | Description | Recommendation | Blocking |
|----|----------|-------|----------|-------------|----------------|----------|
| F-01 | low | Buchholz cut logic has an edge case with 0-1 games | `backend/registrations/tiebreaks.py:74-75` | When a player has played 0 games, `buchholz_cut1` is correctly 0, but the slice `[1:]` on an empty list is handled. When exactly 1 game, `buchholz_cut2` uses `[2:]` which is empty. This is mathematically correct but worth documenting. | Add inline comment explaining cut behavior for 0-2 games played. | false |
| F-02 | low | Frontend tiebreak calculation duplicates backend logic | `web/src/features/event-control/pairings/tiebreaks.ts:1-97` vs `backend/registrations/tiebreaks.py:1-89` | The TypeScript implementation mirrors the Python implementation. Divergence risk exists if one is updated without the other. | The shared test vector `FOUR_PLAYERS` (line 28-36 in tiebreaks.test.ts, line 14-18 in test_tiebreaks.py) provides protection. Consider adding a documentation cross-reference in both files. | false |
| F-03 | nit | Pairing engine node budget might be too generous | `backend/registrations/pairing_engine.py:18` | `NODE_BUDGET = 20000` allows deep backtracking. For 20-30 players, this is adequate, but for larger fields it could cause delays. | Monitor in production. Consider making budget proportional to player count if larger events are planned. | false |
| F-04 | nit | Rating processing error handling could be more specific | `backend/adminapi/round_service.py:829-831` | `InvalidRound` exception during finalise logs an exception but raises a generic `InternalError()`. The operator loses diagnostic context. | Consider including the InvalidRound message in the error response during development/staging (not production, to avoid leaking internals). | false |

## Positives

- **Excellent test coverage**: The season simulation (`test_season_simulation.py`) is particularly strong. It validates the entire pairing → rating → standings pipeline through 1000 games, measuring convergence, spread, rank correlation (0.980), and verifying no rematches across all tournaments.

- **Pure function design**: Both `pairing_engine.py` and `tiebreaks.py` are database-free, clock-free, and deterministic. This makes testing straightforward and eliminates entire classes of concurrency bugs.

- **Idempotent rating processing**: The `RatingRun` gate (line 131-133 in `ratings/services.py`) ensures a round can never be rated twice. Repeat calls with any payload return the first outcome without side effects. This is critical for reliability.

- **Correct Glicko-2 implementation**: The algorithm matches the reference paper (Glickman 2012), including the Illinois root finder for volatility. The worked example from the paper is verified to 4 decimal places (line 11-12 in `glicko2.py`).

- **Frontend/backend parity**: The TypeScript tie-break implementation produces identical results to the Python version, validated by the shared `FOUR_PLAYERS` test vector. This ensures consistent standings display across admin and player views.

- **Colour alternation**: The pairing engine prevents three consecutive games of the same colour where possible (line 100-128 in `pairing_engine.py`). The season simulation confirms only 11 occurrences of three-in-a-row across 200 player-tournaments, and the longest run is 3 (line 543).

- **Swiss score groups**: 72% of boards in rounds 2-5 pair players on equal scores (line 532-534 in season test), demonstrating the cost function is working as intended.

- **No logic in views**: Round service and room snapshots correctly delegate to service modules. Views only orchestrate transactions and map to DTOs.

## Scope Assessment

The implementation is scoped correctly relative to the documented requirements:

1. **Swiss and social balanced pairing** are implemented as specified (EVENT-ENGINE.md). Round robin and manual modes exist as stubs (correctly – they are marked "Later" in FEAT-000).

2. **Tie-break precedence** follows the documented order: points → Buchholz → Buchholz cut 1 → Buchholz cut 2 → Sonneborn-Berger → name order (line 3 in `tiebreaks.py`, line 2 in `tiebreaks.ts`).

3. **Rating pools are separate**: Blitz, rapid, and classical maintain independent rating series. The season test confirms 20 players finish at different ratings in the two pools (line 339-347).

4. **Identity toggles respected**: Standings never expose user IDs publicly. Players who hide their display name show as "Name not shown" (line 194-200 in `test_standings.py`). Ratings respect the `show_ratings` flag (line 183-192).

5. **Byes handled correctly**: Bye counts as 1 point, and for tie-breaks it's a virtual opponent on the player's own score (line 58-62 in `tiebreaks.py`, test at line 73-79 in `test_tiebreaks.py`). This matches the conventional Swiss treatment.

## Contract Compliance

### Backend Rules (.claude/rules/50-backend.mdc)
- ✅ Logic in service modules, not views
- ✅ No N+1 queries (round_service `_View` batch-loads users, registrations, ratings)
- ✅ No raw SQL
- ✅ Migrations present and correct
- ✅ Audit entries written on admin actions (round.generate, round.publish, round.finalise, etc.)

### Frontend Rules (.claude/rules/40-frontend.mdc)
- ✅ No direct fetch in tiebreaks.ts (pure computation)
- ✅ TypeScript types align with backend contract
- ✅ `tiebreaks.ts` and `tiebreaks.py` stay in sync (validated by shared test vector)

### Cross-stack
- ✅ No backend endpoint built without implementation
- ✅ Frontend standings match backend standings (same algorithm, same test data)

## Critical Paths Verified

1. **Round lifecycle**: draft → published → live → completed transitions enforced by state machine (line 4-6 in `round_service.py`). Version conflicts prevented by optimistic lock (line 639-641).

2. **Rating idempotency**: `process_round` can be called multiple times with the same `round_id`. The second call finds the existing `RatingRun` and returns the stored outcome without touching the database (line 131-133 in `ratings/services.py`).

3. **Concurrency**: Round finalisation locks the round row, processes ratings, and writes the ledger in one transaction (line 806-839 in `round_service.py`). A concurrent duplicate call either blocks (same idempotency key) or is rejected (different key).

4. **Rematch avoidance**: The pairing engine tries perfect matching within 20,000 nodes (line 51-85 in `pairing_engine.py`). If a no-rematch solution exists, it finds it. The fallback greedy algorithm allows rematches and reports the count (line 88-97). Season test confirms zero rematches across all 200 rounds (line 521-527).

5. **Colour balance**: No player gets three of the same colour in a row unless unavoidable (line 118-120). Balanced whites vs blacks (line 124-125). Most recent colour breaks ties (line 126-127). Higher-ranked player alternates by board and round parity (line 128).

6. **Standings accuracy**: Only final results count (line 61-70 in `test_standings.py`). Submitted and disputed results are excluded from points and tie-breaks (line 136-143). Buchholz is always the sum of opponents' final scores (line 450-465 in season test, validated independently from the tie-break module).

7. **Rating convergence**: After 5 tournaments (25 games), ratings spread by ~820-894 points (close to the true 760-point range). Standard deviation grows from 225-232 after one tournament to 252-265 after ten. Mean rating change drops from 95-99 points/game to 9-12 points/game, then plateaus (line 283-397 in season test).

## Performance Considerations

- **Pairing time**: The season test generates 100 rounds (10 tournaments × 5 rounds × 2 pools) with 20 players each. The pairing engine completes in under 1 second per round. No performance issues expected for fields up to 50 players.

- **Standings calculation**: `standings()` is O(players × games). With 500 players (MAX_STANDINGS cap) and 5 rounds, this is 2500 game-player pairs. Acceptable for GET requests.

- **Rating processing**: Glicko-2 is O(players × opponents). For a 50-board round (100 players), each player has 1 opponent, so 100 rating updates. The Illinois algorithm converges in <100 iterations per player. Total processing time is subsecond.

## Security Considerations

- ✅ No secrets exposed (no raw rating calculation parameters in DTOs)
- ✅ Owner-only access enforced (room.py line 51-62, pairing lookup line 351-358)
- ✅ No internal IDs in public standings (line 153-162 in `test_standings.py`)
- ✅ Identity toggles respected (display name, rating visibility)

## Recommendations

1. **Add inline documentation** for the Buchholz cut edge cases (F-01). A comment like "With 0 games, cut1=0; with 1 game, cut2=0" would help future maintainers.

2. **Monitor pairing performance** in production. If events grow beyond 50 players, consider a dynamic node budget or a simpler cost function.

3. **Keep test vectors in sync**. The shared `FOUR_PLAYERS` example provides frontend/backend parity. Any changes to tie-break logic must update both test files.

4. **Document the rating period choice**. Each round is its own rating period (confirmed by the season test's plateau at 9-12 points/game). This is a design decision worth recording in the architecture docs.

## Conclusion

The pairing and rating logic is **correct, well-tested, and production-ready**. The pure function design, comprehensive test coverage, and idempotent rating processing provide a solid foundation. The season simulation validates end-to-end behavior across 1000 games and confirms convergence, fairness, and correctness.

No blocking issues found. The four findings are minor: two documentation suggestions, one monitoring recommendation, and one error reporting improvement. All are tracked above with severity low or nit.

**Status: Approved**

---

## Metadata

```yaml
id: REVIEW-001
type: code-review
feature_id: FEAT-001
reviewer: code-reviewer
status: approved
requirements_status: pass
architecture_status: pass
testing_status: pass
```
