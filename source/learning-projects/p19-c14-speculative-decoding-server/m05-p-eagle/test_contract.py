import random
import unittest

import main


class TestDraftModelPropose(unittest.TestCase):
    def test_proposes_best_tokens_and_tracks_call(self):
        class FakeTarget:
            def __init__(self):
                self.seeds = []

            def distribution(self, ctx_seed):
                self.seeds.append(ctx_seed)
                return {
                    5: [0.1, 0.7, 0.2],
                    6: [0.8, 0.1, 0.1],
                    7: [0.2, 0.3, 0.5],
                }[ctx_seed]

        draft = main.DraftModel(alignment=1.0)
        target = FakeTarget()
        proposed = draft.propose(5, 3, random.Random(123), target)

        self.assertEqual(proposed, [1, 0, 2])
        self.assertEqual(target.seeds, [5, 6, 7])
        self.assertEqual(draft.calls, 1)
        self.assertEqual(draft.propose(5, 0, random.Random(123), target), [])
        self.assertEqual(draft.calls, 2)


class TestBaselineDecode(unittest.TestCase):
    def test_generates_exact_count_and_advances_context(self):
        class FakeTarget:
            def __init__(self):
                self.calls = 0
                self.seeds = []

            def distribution(self, ctx_seed):
                self.seeds.append(ctx_seed)
                return [0.25, 0.75]

        target = FakeTarget()
        metrics = main.baseline_decode(4, random.Random(7), target)

        self.assertEqual(metrics.generated, 4)
        self.assertEqual(metrics.target_calls, 4)
        self.assertEqual(metrics.draft_calls, 0)
        self.assertEqual(metrics.accepted_sum, 0)
        self.assertEqual(target.calls, 4)
        self.assertEqual(target.seeds, [1, 2, 3, 4])

        empty_target = FakeTarget()
        empty = main.baseline_decode(0, random.Random(7), empty_target)
        self.assertEqual((empty.generated, empty.target_calls), (0, 0))
        self.assertEqual(empty_target.seeds, [])


class TestMetricsTokensPerTargetCall(unittest.TestCase):
    def test_ratio_and_zero_call_guard(self):
        self.assertEqual(
            main.Metrics(generated=9, target_calls=3).tokens_per_target_call(),
            3.0,
        )
        self.assertEqual(
            main.Metrics(generated=0, target_calls=0).tokens_per_target_call(),
            0.0,
        )
        self.assertEqual(
            main.Metrics(generated=5, target_calls=0).tokens_per_target_call(),
            5.0,
        )


class TestSpeculativeDecode(unittest.TestCase):
    def test_commits_prefix_resamples_and_stops_exactly(self):
        class FakeDraft:
            def __init__(self):
                self.requests = []

            def propose(self, ctx_seed, k, rng, target):
                self.requests.append((ctx_seed, k))
                return [100 + ctx_seed + pos for pos in range(k)]

        class FakeTarget:
            def __init__(self):
                self.requests = []

            def verify(self, draft_tokens, ctx_seed, rng):
                self.requests.append((list(draft_tokens), ctx_seed))
                if ctx_seed == 1:
                    return [10, 11], 90
                if ctx_seed == 4:
                    return [20, 21, 22], 91
                raise AssertionError('unexpected scheduler context')

        draft = FakeDraft()
        target = FakeTarget()
        metrics = main.speculative_decode(5, 3, random.Random(9), target, draft)

        self.assertEqual(metrics.generated, 5)
        self.assertEqual(metrics.target_calls, 2)
        self.assertEqual(metrics.draft_calls, 2)
        self.assertEqual(metrics.accepted_sum, 5)
        self.assertEqual(draft.requests, [(1, 3), (4, 3)])
        self.assertEqual([request[1] for request in target.requests], [1, 4])


class TestMetricsAcceptanceRate(unittest.TestCase):
    def test_rate_and_no_target_calls(self):
        metrics = main.Metrics(target_calls=3, accepted_sum=6)
        self.assertEqual(metrics.acceptance_rate(4), 0.5)

        no_calls = main.Metrics(target_calls=0, accepted_sum=7)
        self.assertEqual(no_calls.acceptance_rate(4), 0.0)


class TestTargetModelVerify(unittest.TestCase):
    def test_stops_at_first_rejection_and_resamples_there(self):
        class FixedTarget(main.TargetModel):
            def distribution(self, ctx_seed):
                self.seeds.append(ctx_seed)
                return {
                    10: [0.6, 0.4],
                    11: [0.9, 0.1],
                    12: [0.2, 0.8],
                }[ctx_seed]

        class ZeroRng:
            def random(self):
                return 0.0

        target = FixedTarget()
        target.seeds = []
        accepted, next_token = target.verify([0, 1, 1], 10, ZeroRng())

        self.assertEqual(accepted, [0])
        self.assertEqual(next_token, 0)
        self.assertEqual(target.calls, 1)
        self.assertEqual(target.tokens_verified, 4)
        self.assertEqual(target.seeds, [10, 11, 11])


if __name__ == '__main__':
    unittest.main()
