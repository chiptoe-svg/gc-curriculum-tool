# Final fix wave report (feat/interview-add-file)

RED/GREEN per finding (scratch DB only):
1. STATE.md: deploy-order sentence (bold), cost-cap note, orphan deferral removed. Doc only.
2. Duplicate never read: RED 4 route tests failed (pending/failed/queued enqueue, set-aside); GREEN after route change. Client: poll for non-ready dup, dup chips never delete the existing material, set-aside label + unreadable marker, de-dupe by id (RED shown by disabling the check; GREEN restored).
3. Worker skipped: new chip state; fake-timer tests for skipped-stop (RED before) and the 120 s give-up (already green on the existing code: pins existing behavior).
4. Send with file and no note: RED (Send disabled), GREEN.
5. Queue priority: scratch test lib/db/__tests__/claim-interview-first.test.ts RED (order wrong), GREEN after ORDER BY (added_in_session IS NULL), uploaded_at. Suite RAN (scratch-gated).
6. Cost-cap note in STATE.md only.
7. splitFileMarkers helper + unit tests RED (not a function) then GREEN; panel renders chips (RED then GREEN).
8. AddFileButton owns clearing via handle.clearSent(ids). The race test was NOT reproducible RED on the old code (filesRef is resynced each render, so the window is only within a synchronous handler); ownership implemented as ruled, test pins no double marker. Honest: no red form.
9. getMaterialStatusInCourse (id/statuses, course-scoped) + route; RED on old route (test mocks the new query), GREEN; 404 for another course kept; scratch test of the query scoping.

Suite: 641 files passed, 39 skipped; 4941 tests passed, 360 skipped. tsc clean. Log: .superpowers/sdd/add-file-fixwave.log
