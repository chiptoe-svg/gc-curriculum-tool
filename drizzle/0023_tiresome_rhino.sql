ALTER TABLE "capture_messages" ADD CONSTRAINT "uq_capture_messages_session_turn" UNIQUE("session_id","turn_index");
