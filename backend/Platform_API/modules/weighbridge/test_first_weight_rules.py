from types import SimpleNamespace

from django.test import SimpleTestCase

from Platform_API.modules.weighbridge.views import _blocks_new_first_weight


def first_weight(*, status="Completed", payment_status="Paid", paired=False):
    return SimpleNamespace(
        operation_type=SimpleNamespace(flow_kind="first"),
        weight_type="First Weight",
        status=status,
        payment_status=payment_status,
        paired=paired,
    )


class FirstWeightDuplicateRuleTests(SimpleTestCase):
    def test_completed_paid_first_weight_does_not_block_another_first_weight(self):
        self.assertFalse(_blocks_new_first_weight(first_weight()))

    def test_draft_first_weight_blocks_another_first_weight(self):
        self.assertTrue(_blocks_new_first_weight(first_weight(status="Draft")))

    def test_pending_payment_first_weight_blocks_another_first_weight(self):
        self.assertTrue(_blocks_new_first_weight(first_weight(payment_status="Pending")))

    def test_paired_first_weight_does_not_block_another_first_weight(self):
        self.assertFalse(_blocks_new_first_weight(first_weight(status="Draft", paired=True)))
