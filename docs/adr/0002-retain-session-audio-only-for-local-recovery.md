# Prefer transcript checkpoints to audio recovery

Specular temporarily retains session-audio chunks on the author's device only until the corresponding transcript checkpoint is durable. If capture is interrupted, it preserves all checkpointed text, marks the exact interruption boundary, and discards the small untranscribed tail instead of retaining audio for later recovery; this accepts losing seconds to prevent losing minutes while avoiding a recoverable audio archive.
