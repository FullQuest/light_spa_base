import unittest

from algorithm.input import copy_tables, duration_seconds, event_precedences, problem_from_tables


class InputTests(unittest.TestCase):
    def test_named_copy_columns_and_postgres_escaping(self):
        tables = copy_tables('COPY public.employee (first_name, tabel, middle_name) FROM stdin;\n'
                             'Иван\\tИван\t11\t\\N\n\\.\n')
        self.assertEqual(tables["employee"], [{"first_name": "Иван\tИван", "tabel": "11", "middle_name": None}])

    def test_intervals_do_not_wrap_after_24_hours(self):
        self.assertEqual(duration_seconds("2 days 01:02:03.5"), 176523.5)
        self.assertEqual(duration_seconds("32:15:00"), 116100)
        for invalid in ["1 month", "-01:00:00", "01:90:00"]:
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                duration_seconds(invalid)

    def test_transitive_dependencies_across_objects_without_incidents(self):
        active = [{"id_edifice": "1", "resource_type": "water", "id_event": "10"},
                  {"id_edifice": "3", "resource_type": "water", "id_event": "30"},
                  {"id_edifice": "3", "resource_type": "energy", "id_event": "31"}]
        edges = [{"id_edifice_source": "1", "id_edifice_dependent": "2", "resource_type": "water"},
                 {"id_edifice_source": "2", "id_edifice_dependent": "3", "resource_type": "water"}]
        self.assertEqual(event_precedences(active, edges), ((10, 30),))
        with self.assertRaisesRegex(ValueError, "cycle"):
            event_precedences(active, edges + [{"id_edifice_source": "3", "id_edifice_dependent": "1", "resource_type": "water"}])

    def test_only_latest_object_resource_status_is_active(self):
        tables = {
            "employee": [{"tabel": "1"}, {"tabel": "2"}],
            "qualification": [{"id_employee": "1", "resource_type": "water", "proff": "5"}],
            "event_statuses": [{"id_status": "1", "name": "Активная авария"}, {"id_status": "3", "name": "Норма"}],
            "events": [{"id_event": "10", "id_edifice": "1", "resource_type": "water", "occurred_at": "2026-01-01", "id_status": "1"},
                       {"id_event": "11", "id_edifice": "1", "resource_type": "water", "occurred_at": "2026-01-02", "id_status": "3"},
                       {"id_event": "12", "id_edifice": "2", "resource_type": "water", "occurred_at": "2026-01-02", "id_status": "1"}],
            "time_resolve": [{"id_edifice": "2", "resource_type": "water", "avg_resolution_time": "01:00:00"}],
            "edifice_dependencies": [],
        }
        result = problem_from_tables(tables)
        self.assertEqual([event.event_id for event in result.incidents], [12])
        self.assertEqual(result.incidents[0].base_duration_seconds, 3600)
        tables["time_resolve"] = []
        with self.assertRaisesRegex(ValueError, "Missing base"):
            problem_from_tables(tables)


if __name__ == "__main__":
    unittest.main()
