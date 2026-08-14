# Use bounded transcription checkpoints

Specular transcribes short, completed audio chunks throughout a dictation session instead of maintaining a word-by-word Realtime transcription stream. Frequent chunk results still protect long sessions and provide visible progress, while the selected transcription endpoint currently carries no abuse-monitoring or application-state retention; the trade-off is checkpointed rather than instantaneous text.
