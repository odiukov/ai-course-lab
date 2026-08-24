import unittest
from unittest.mock import call, patch

import main


class TestSceneEmbed(unittest.TestCase):
    def test_populates_all_three_embeddings(self):
        scene = main.Scene(
            "video-1", 7, 100, 900, "a caption", "spoken words", "frame tags"
        )
        vectors = [[1.0], [2.0], [3.0]]

        with patch.object(main, "fake_embed", side_effect=vectors) as fake_embed:
            result = scene.embed()

        self.assertIsNone(result)
        self.assertEqual(scene.caption_emb, [1.0])
        self.assertEqual(scene.frame_emb, [2.0])
        self.assertEqual(scene.transcript_emb, [3.0])
        self.assertEqual(
            fake_embed.call_args_list,
            [call("a caption"), call("frame tags"), call("spoken words")],
        )


class TestCosine(unittest.TestCase):
    def test_dot_product_and_zip_length_semantics(self):
        self.assertAlmostEqual(main.cosine([1.5, -2.0, 4.0], [2.0, 3.0, -0.5]), -5.0)
        self.assertEqual(main.cosine([], []), 0)
        self.assertEqual(main.cosine([2.0, 3.0], [4.0]), 8.0)


class TestMultiVectorSearch(unittest.TestCase):
    @staticmethod
    def make_scene(label, scene_id):
        scene = main.Scene(label, scene_id, 0, 1000, label, label, label)
        scene.caption_emb = [label + "_cap"]
        scene.frame_emb = [label + "_frm"]
        scene.transcript_emb = [label + "_trn"]
        return scene

    def test_fuses_three_rankings_with_rrf_and_applies_k(self):
        scenes = [self.make_scene(label, i) for i, label in enumerate("ABCD")]
        scores = {
            "A_cap": 4, "B_cap": 3, "C_cap": 2, "D_cap": 1,
            "A_frm": 2, "B_frm": 4, "C_frm": 3, "D_frm": 1,
            "A_trn": 2, "B_trn": 3, "C_trn": 4, "D_trn": 1,
        }

        with patch.object(main, "fake_embed", return_value=[99.0]) as fake_embed, patch.object(
            main, "cosine", side_effect=lambda query_vector, candidate: scores[candidate[0]]
        ) as cosine:
            hits = main.multi_vector_search("query", scenes, k=3)

        self.assertEqual([scene.video_id for scene, _ in hits], ["B", "C", "A"])
        self.assertEqual(len({(scene.video_id, scene.scene_id) for scene, _ in hits}), 3)
        expected = [
            1 / 61 + 2 / 62,
            1 / 61 + 1 / 62 + 1 / 63,
            1 / 61 + 2 / 63,
        ]
        for (_, actual_score), expected_score in zip(hits, expected):
            self.assertAlmostEqual(actual_score, expected_score)
        fake_embed.assert_called_once_with("query")
        self.assertEqual(cosine.call_count, 12)


class TestGroundWindow(unittest.TestCase):
    def test_refines_matches_and_preserves_scene_bounds_for_fallbacks(self):
        scene = main.Scene(
            "video", 1, 1000, 11000, "caption", "zero alpha middle beta tail", "frame"
        )
        self.assertEqual(main.ground_window("alpha beta", scene), (2500, 9500))
        self.assertEqual(main.ground_window("zero tail", scene), (1000, 11000))
        self.assertEqual(main.ground_window("absent", scene), (1000, 11000))
        self.assertEqual(main.ground_window("", scene), (1000, 11000))

        silent = main.Scene("video", 2, 20, 80, "caption", "", "frame")
        self.assertEqual(main.ground_window("anything", silent), (20, 80))


class TestFormatMilliseconds(unittest.TestCase):
    def test_formats_floor_seconds_as_minutes_and_seconds(self):
        cases = {
            0: "00:00",
            999: "00:00",
            59_999: "00:59",
            60_000: "01:00",
            125_999: "02:05",
            3_600_000: "60:00",
        }
        for milliseconds, expected in cases.items():
            with self.subTest(milliseconds=milliseconds):
                self.assertEqual(main.fmt_ms(milliseconds), expected)


if __name__ == "__main__":
    unittest.main()
