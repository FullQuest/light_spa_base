from datetime import datetime, timedelta
import unittest
from pydantic import ValidationError
from modules.sources.models import Source, SourceSchedule, SourceWrite
from modules.sources.schedule import next_poll_time


class ScheduleTests(unittest.TestCase):
    def test_interval_and_pause(self):
        source = Source(name="Test", url="http://example.test", interval_seconds=300)
        now = datetime(2026, 11, 16, 5, 59)
        self.assertEqual(next_poll_time(source, None, now), now + timedelta(seconds=300))
        source.enabled = False
        self.assertIsNone(next_poll_time(source, None, now))

    def test_calendar_before_exact_time_and_weekend(self):
        source = Source(name="Test", url="http://example.test")
        schedule = SourceSchedule(source_id=source.id, time="09:00", weekdays=[0, 1, 2, 3, 4])
        self.assertEqual(next_poll_time(source, schedule, datetime(2026, 11, 16, 5, 59)), datetime(2026, 11, 16, 6))
        self.assertEqual(next_poll_time(source, schedule, datetime(2026, 11, 16, 6)), datetime(2026, 11, 17, 6))
        self.assertEqual(next_poll_time(source, schedule, datetime(2026, 11, 20, 6, 1)), datetime(2026, 11, 23, 6))

    def test_moscow_date_boundary_and_single_weekday(self):
        source = Source(name="Test", url="http://example.test")
        schedule = SourceSchedule(source_id=source.id, time="00:30", weekdays=[1])
        self.assertEqual(next_poll_time(source, schedule, datetime(2026, 11, 16, 21, 20)), datetime(2026, 11, 16, 21, 30))
        self.assertEqual(next_poll_time(source, schedule, datetime(2026, 11, 16, 21, 30)), datetime(2026, 11, 23, 21, 30))

    def test_schedule_validation(self):
        base = {"name": "Test", "url": "http://example.test", "schedule_mode": "calendar"}
        for settings in [{"schedule_time": "25:00"}, {"schedule_time": "9:00"}, {"weekdays": []}, {"weekdays": [7]}, {"weekdays": [-1]}]:
            with self.assertRaises(ValidationError):
                SourceWrite(**base, **settings)
        self.assertEqual(SourceWrite(**base, weekdays=[4, 0, 4]).weekdays, [0, 4])
