import unittest
from unittest.mock import patch

import main


class _MetricsDouble:
    def __init__(self):
        self.events = []
        self.turn_complete_ms = 0
        self.first_llm_token_ms = 0
        self.first_audio_out_ms = 0
        self.false_cutoffs = 0
        self.barge_ins = 0

    def log(self, message):
        self.events.append(message)


class TestTurnCompletionScore(unittest.TestCase):
    def test_empty_punctuation_and_word_boundaries(self):
        cases = [
            ("", 0.0),
            ("one two", 0.2),
            ("one two three", 0.55),
            ("one two three four five", 0.55),
            ("one two three four five six", 0.75),
            ("ready?   ", 0.95),
            ("done.", 0.95),
            ("stop!", 0.95),
        ]
        for partial, expected in cases:
            with self.subTest(partial=partial):
                self.assertEqual(main.turn_completion_score(partial), expected)


class TestMetricsLog(unittest.TestCase):
    def test_appends_exact_messages_in_order(self):
        metrics = main.Metrics()
        metrics.log("first event")
        metrics.log("")
        metrics.log("first event")
        self.assertEqual(metrics.events, ["first event", "", "first event"])


class TestMetricsLatencyMs(unittest.TestCase):
    def test_requires_both_timestamps_and_computes_delta(self):
        cases = [
            (main.Metrics(), -1),
            (main.Metrics(turn_complete_ms=500), -1),
            (main.Metrics(first_audio_out_ms=820), -1),
            (main.Metrics(turn_complete_ms=500, first_audio_out_ms=820), 320),
            (main.Metrics(turn_complete_ms=900, first_audio_out_ms=900), 0),
        ]
        for metrics, expected in cases:
            with self.subTest(metrics=metrics):
                self.assertEqual(metrics.latency_ms(), expected)


class TestRunSession(unittest.TestCase):
    @staticmethod
    def _initial_frames(end_exclusive):
        partial = "one two three four five six"
        frames = [
            main.Frame(t_ms=0, is_speech=True, partial=partial),
            main.Frame(t_ms=20, is_speech=True, partial=partial),
        ]
        frames.extend(
            main.Frame(t_ms=t, is_speech=False, partial=partial)
            for t in range(40, end_exclusive, 20)
        )
        return frames

    def test_barge_in_cancels_thinking_and_rearms_new_turn(self):
        frames = self._initial_frames(620)
        frames.append(main.Frame(620, True, "new request starts"))
        frames.append(main.Frame(640, True, "new request is complete now please"))
        frames.extend(
            main.Frame(t, False, "new request is complete now please")
            for t in range(660, 1300, 20)
        )

        with patch.object(main, "Metrics", _MetricsDouble), patch.object(
            main, "turn_completion_score", return_value=0.75
        ):
            metrics = main.run_session(
                frames, use_tool=False, barge_in_at_ms=620
            )

        self.assertEqual(metrics.barge_ins, 1)
        self.assertIn(
            "620ms BARGE-IN: cancel TTS, re-arm ASR", metrics.events
        )
        self.assertEqual(metrics.first_llm_token_ms, 1280)
        self.assertEqual(metrics.first_audio_out_ms, 0)
        self.assertTrue(
            any("1140ms TURN COMPLETE" in event for event in metrics.events)
        )

    def test_barge_in_cancels_speaking_before_audio(self):
        frames = self._initial_frames(700)
        frames.append(main.Frame(700, True, "interrupt now"))

        with patch.object(main, "Metrics", _MetricsDouble), patch.object(
            main, "turn_completion_score", return_value=0.75
        ):
            metrics = main.run_session(
                frames, use_tool=False, barge_in_at_ms=700
            )

        self.assertEqual(metrics.barge_ins, 1)
        self.assertEqual(metrics.first_llm_token_ms, 660)
        self.assertEqual(metrics.first_audio_out_ms, 0)
        self.assertEqual(
            metrics.events[-1],
            "700ms BARGE-IN: cancel TTS, re-arm ASR",
        )
        self.assertFalse(any("TTS first audio-out" in e for e in metrics.events))


class TestSynthCall(unittest.TestCase):
    def test_frame_geometry_partials_and_noise(self):
        random_values = [0.10, 0.49, 0.50, 0.90, 0.00, 0.70]
        with patch.object(
            main.random, "random", side_effect=random_values
        ) as random_mock:
            frames = main.synth_call(
                "hello world", start_ms=100, noise=0.5
            )

        self.assertEqual(len(frames), 6 + 2 * 16 + 110)
        self.assertEqual(
            [frame.t_ms for frame in frames],
            [100 + 20 * index for index in range(len(frames))],
        )
        self.assertEqual(
            [frame.is_speech for frame in frames[:6]],
            [True, True, False, False, True, False],
        )
        self.assertTrue(all(frame.partial == "" for frame in frames[:6]))
        self.assertTrue(
            all(
                frame.is_speech and frame.partial == "hello"
                for frame in frames[6:22]
            )
        )
        self.assertTrue(
            all(
                frame.is_speech and frame.partial == "hello world"
                for frame in frames[22:38]
            )
        )
        self.assertTrue(
            all(
                not frame.is_speech and frame.partial == "hello world"
                for frame in frames[38:]
            )
        )
        self.assertEqual(random_mock.call_count, 6)
