"""
Speaker Verifier — Caller Voice Identification
================================================

Uses Resemblyzer to generate speaker embeddings and verify that
incoming speech belongs to the actual caller (not background speakers).

Pipeline:
  1. Enrollment: First ~3 seconds of confirmed speech → reference embedding
  2. Verification: Every subsequent chunk → compare cosine similarity
  3. If similarity > threshold → it's the caller
  4. If similarity < threshold → background speaker, ignore

Reference: https://github.com/resemble-ai/Resemblyzer
"""

import numpy as np
from typing import Tuple, Optional
import time


class SpeakerVerifier:
    """
    Production-grade caller voice verification.

    Captures the caller's voice print from the first few seconds of speech,
    then verifies all subsequent audio against this print.
    """

    def __init__(
        self,
        sample_rate: int = 16000,
        enrollment_seconds: float = 3.0,
        similarity_threshold: float = 0.75,
    ):
        self.sample_rate = sample_rate
        self.enrollment_seconds = enrollment_seconds
        self.similarity_threshold = similarity_threshold

        # Lazy-load the encoder to avoid slowing down imports
        self._encoder = None
        self._model_loaded = False

        # Enrollment state
        self.reference_embedding = None
        self.enrollment_buffer = []
        self.enrollment_duration = 0.0
        self.is_enrolled = False

        print(f"[Speaker Verifier] Initialized (enrollment={enrollment_seconds}s, threshold={similarity_threshold})")

    def _load_model(self):
        """Lazy-load Resemblyzer encoder on first use."""
        if self._model_loaded:
            return

        try:
            from resemblyzer import VoiceEncoder
            print("[Speaker Verifier] Loading Resemblyzer voice encoder...")
            start = time.time()
            self._encoder = VoiceEncoder(device="cpu")
            self._model_loaded = True
            print(f"[Speaker Verifier] ✅ Encoder loaded ({time.time()-start:.1f}s)")
        except ImportError:
            print("[Speaker Verifier] ❌ resemblyzer not installed. Run: pip install resemblyzer")
            self._encoder = None
            self._model_loaded = True  # Don't retry
        except Exception as e:
            print(f"[Speaker Verifier] ❌ Failed to load encoder: {e}")
            self._encoder = None
            self._model_loaded = True

    def reset(self):
        """Reset enrollment (call at start of each new call)."""
        self.reference_embedding = None
        self.enrollment_buffer = []
        self.enrollment_duration = 0.0
        self.is_enrolled = False
        print("[Speaker Verifier] Reset for new call")

    def _get_embedding(self, audio: np.ndarray) -> Optional[np.ndarray]:
        """Generate a speaker embedding from audio."""
        if self._encoder is None:
            return None

        try:
            # Resemblyzer expects float32 audio normalized to [-1, 1]
            if audio.dtype != np.float32:
                audio = audio.astype(np.float32)

            max_val = np.max(np.abs(audio))
            if max_val > 1.0:
                audio = audio / max_val

            # Minimum length check (Resemblyzer needs at least ~1.6s for good embeddings)
            min_samples = int(self.sample_rate * 0.5)
            if len(audio) < min_samples:
                return None

            embedding = self._encoder.embed_utterance(audio)
            return embedding

        except Exception as e:
            print(f"[Speaker Verifier] Embedding error: {e}")
            return None

    def _cosine_similarity(self, a: np.ndarray, b: np.ndarray) -> float:
        """Compute cosine similarity between two embeddings."""
        dot = np.dot(a, b)
        norm_a = np.linalg.norm(a)
        norm_b = np.linalg.norm(b)
        if norm_a == 0 or norm_b == 0:
            return 0.0
        return float(dot / (norm_a * norm_b))

    def enroll(self, audio_chunk: np.ndarray) -> bool:
        """
        Feed audio during enrollment phase. Returns True when enrollment is complete.

        Args:
            audio_chunk: float32 audio chunk from confirmed speech

        Returns:
            True if enrollment just completed, False if still collecting
        """
        if self.is_enrolled:
            return True

        self._load_model()
        if self._encoder is None:
            # No model available — auto-pass everything
            self.is_enrolled = True
            return True

        self.enrollment_buffer.extend(audio_chunk.tolist())
        self.enrollment_duration += len(audio_chunk) / self.sample_rate

        if self.enrollment_duration >= self.enrollment_seconds:
            # We have enough audio — generate the reference embedding
            enrollment_audio = np.array(self.enrollment_buffer, dtype=np.float32)
            self.reference_embedding = self._get_embedding(enrollment_audio)

            if self.reference_embedding is not None:
                self.is_enrolled = True
                self.enrollment_buffer = []  # Free memory
                print(f"[Speaker Verifier] ✅ Caller enrolled ({self.enrollment_duration:.1f}s of speech)")
                return True
            else:
                # Failed to generate embedding, try with more audio
                print("[Speaker Verifier] ⚠️ Enrollment embedding failed, collecting more audio...")
                self.enrollment_seconds += 1.0  # Need more
                return False

        return False

    def verify(self, audio_chunk: np.ndarray) -> Tuple[bool, float]:
        """
        Verify if the audio chunk belongs to the enrolled caller.

        Args:
            audio_chunk: float32 audio chunk to verify

        Returns:
            (is_caller, similarity_score)
            - is_caller: True if speech matches the caller
            - similarity_score: Cosine similarity (0.0 to 1.0)
        """
        # If model failed to load, pass everything through (fail-open)
        if self._encoder is None:
            return True, 1.0

        # If not enrolled yet, try to enroll with this chunk
        if not self.is_enrolled:
            self.enroll(audio_chunk)
            # During enrollment, assume it's the caller (they're the first speaker)
            return True, 1.0

        # Generate embedding for incoming chunk
        chunk_embedding = self._get_embedding(audio_chunk)
        if chunk_embedding is None:
            # Chunk too short for embedding — pass through
            return True, 0.8

        # Compare with reference
        similarity = self._cosine_similarity(self.reference_embedding, chunk_embedding)

        is_caller = similarity >= self.similarity_threshold

        if not is_caller:
            print(f"[Speaker Verifier] 🛡️ Background speaker rejected (sim={similarity:.2f})")

        return is_caller, similarity


# Test
if __name__ == "__main__":
    print("Testing Speaker Verifier...")

    sv = SpeakerVerifier(sample_rate=16000, enrollment_seconds=2.0, similarity_threshold=0.75)

    # Simulate enrollment with sine wave "voice"
    t = np.linspace(0, 2, 32000)
    fake_caller = (np.sin(2 * np.pi * 300 * t) * 0.5).astype(np.float32)

    # Enroll
    enrolled = sv.enroll(fake_caller)
    print(f"Enrolled: {enrolled}")

    # Verify same voice
    is_caller, sim = sv.verify(fake_caller[:8000])
    print(f"Same voice: is_caller={is_caller}, similarity={sim:.3f}")

    # Verify different voice
    different = (np.sin(2 * np.pi * 800 * t) * 0.5).astype(np.float32)
    is_caller, sim = sv.verify(different[:8000])
    print(f"Different voice: is_caller={is_caller}, similarity={sim:.3f}")

    print("\n✅ Speaker Verifier tests complete!")
