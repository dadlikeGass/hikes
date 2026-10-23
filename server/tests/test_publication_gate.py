"""Exercise real route handlers with isolated database doubles; no production connection."""
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

os.environ['DATABASE_URL'] = 'sqlite://'
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fastapi import HTTPException
from app import main


class PublicationGateTests(unittest.TestCase):
    def test_comment_routes_do_not_write_on_review_failure(self):
        calls = [
            lambda: main.add_comment(main.CommentIn(text='测试留言'), Mock(), point_id=1, uid=2),
            lambda: main.add_seg_comment(main.CommentIn(text='测试留言'), Mock(), sid=1, uid=2),
            lambda: main.add_comment_reply(1, main.CommentIn(text='测试回复'), Mock(), uid=2),
        ]
        for call in calls:
            with self.subTest(handler=call), patch.object(main, 'q1', return_value={'id': 1}), \
                    patch.object(main, '_rate_check', return_value=[]), \
                    patch.object(main, '_reject_duplicate_comment'), \
                    patch.object(main, '_moderate_public_text', side_effect=HTTPException(503)), \
                    patch.object(main, 'engine') as engine:
                with self.assertRaises(HTTPException):
                    call()
                engine.begin.assert_not_called()

    def test_failed_draft_review_keeps_draft_and_creates_no_comment(self):
        with patch.object(main, 'q1', return_value={'id': 1}), \
                patch.object(main, '_moderate_public_text', side_effect=HTTPException(422)), \
                patch.object(main, 'engine') as engine:
            conn = engine.begin.return_value.__enter__.return_value
            conn.execute.return_value.mappings.return_value.first.return_value = {
                'id': 3, 'public_comment_draft': '待审核草稿'}
            with self.assertRaises(HTTPException):
                main.publish_arrival_draft('CODE', uid=2)
            self.assertEqual(conn.execute.call_count, 1)  # Only the locked draft SELECT.
            self.assertIn('SELECT', str(conn.execute.call_args.args[0]))


if __name__ == '__main__':
    unittest.main()
