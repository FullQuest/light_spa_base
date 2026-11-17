"""Контракт реального графа и безопасная синхронизация на изолированной SQLite."""
from copy import deepcopy
from datetime import datetime, timezone
import unittest
from unittest.mock import patch

from sqlalchemy import event as sql_event
from sqlmodel import Session, SQLModel, create_engine, select
from sqlalchemy.pool import StaticPool

from modules.infra_loader import loader
from modules.infra_loader.models import Edifice, Event, InfrastructureSync


def fixture():
    return (
        [dict(id_status=1, name='Активная авария'), dict(id_status=2, name='Ремонтные работы'), dict(id_status=3, name='Норма')],
        [dict(id_edifice=i, name=f'Объект {i}', resource_type=['water', 'energy'], district='Район', street='Мира', house_number=str(i)) for i in (1, 2, 3)],
        [dict(resource_type='water', id_edifice_source=1, id_edifice_dependent=2), dict(resource_type='water', id_edifice_source=2, id_edifice_dependent=3)],
        [dict(id_event=i, id_status=status, id_edifice=1, resource_type=resource, occurred_at=datetime(2026, 11, 16, hour))
         for i, status, resource, hour in [(1, 3, 'water', 10), (2, 1, 'water', 11), (3, 2, 'energy', 11), (4, 3, 'water', 12), (5, 1, 'water', 12)]],
    )


class GraphTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine('sqlite://', connect_args={'check_same_thread': False}, poolclass=StaticPool)
        @sql_event.listens_for(self.engine, 'connect')
        def foreign_keys(connection, record):
            connection.execute('PRAGMA foreign_keys=ON')
        SQLModel.metadata.create_all(self.engine)
        self.session = Session(self.engine)
        self.addCleanup(self.engine.dispose)
        self.addCleanup(self.session.close)
        for name, value in [('_last_attempt', 0.0), ('_last_success', None), ('_last_result', None), ('_source_status', 'unavailable')]:
            mock = patch.object(loader, name, value)
            mock.start()
            self.addCleanup(mock.stop)

    def seed(self, data=None):
        return loader._replace_local(self.session, data or fixture())

    def test_real_snapshot_uses_latest_event_per_resource_and_numeric_tie_break(self):
        self.seed()
        result = loader.graph_snapshot(self.session, datetime(2026, 11, 16, 9, tzinfo=timezone.utc))
        self.assertFalse(result['demo'])
        self.assertEqual(len(result['objects']), 3)
        self.assertEqual([(e['source'], e['target']) for e in result['dependencies']], [('1', '2'), ('2', '3')])
        self.assertEqual([e['id'] for e in result['currentEvents']], ['5', '3'])
        self.assertEqual(result['currentEvents'][0]['occurredAt'], '2026-11-16T12:00:00+03:00')
        self.assertEqual(result['objects'][0]['states'], {})
        earlier = loader.graph_snapshot(self.session, datetime(2026, 11, 16, 7, 30, tzinfo=timezone.utc))
        self.assertEqual([e['id'] for e in earlier['currentEvents']], ['1'])
        self.assertEqual(earlier['topologyRevision'], result['topologyRevision'])
        self.assertNotEqual(earlier['eventRevision'], result['eventRevision'])

    def test_archive_contains_all_events_with_original_ids_and_object_names(self):
        self.seed()
        result = loader.event_archive(self.session)['events']
        self.assertEqual([e['id'] for e in result], ['5', '4', '3', '2', '1'])
        self.assertEqual(result[0]['objectName'], 'Объект 1')
        self.assertEqual(result[0]['status'], 'incident')

    def test_invalid_cycle_or_resource_leaves_cache_intact(self):
        self.seed()
        cycle, bad_resource = deepcopy(fixture()), deepcopy(fixture())
        cycle[2].append(dict(resource_type='water', id_edifice_source=3, id_edifice_dependent=1))
        bad_resource[2][0]['resource_type'] = 'gas'
        for data in [cycle, bad_resource]:
            with self.assertRaises(ValueError):
                loader._replace_local(self.session, data)
        self.assertEqual(len(self.session.exec(select(Edifice)).all()), 3)
        self.assertEqual(len(self.session.exec(select(Event)).all()), 5)

    def test_duplicate_event_rolls_back_entire_replacement(self):
        self.seed()
        data = deepcopy(fixture())
        data[3].append(data[3][0])
        with self.assertRaises(Exception):
            loader._replace_local(self.session, data)
        self.assertEqual(len(self.session.exec(select(Event)).all()), 5)

    def test_synchronization_failure_keeps_cache_and_last_success(self):
        with patch.object(loader, '_read_external', return_value=fixture()) as read:
            self.assertIsNotNone(loader.sync_if_due(self.session, force=True))
            loader.sync_if_due(self.session)
            self.assertEqual(read.call_count, 1)
        saved_time = loader.sync_metadata(self.session)['syncedAt']
        with patch.object(loader, '_read_external', side_effect=ConnectionError('offline')):
            self.assertIsNone(loader.sync_if_due(self.session, force=True))
        self.assertEqual(loader.sync_metadata(self.session), {'sourceStatus': 'stale', 'syncedAt': saved_time})
        self.assertEqual(len(loader.event_archive(self.session)['events']), 5)
        self.assertIsNotNone(self.session.get(InfrastructureSync, 1))

    def test_failure_without_cache_reports_unavailable(self):
        with patch.object(loader, '_read_external', side_effect=ConnectionError('offline')):
            loader.sync_if_due(self.session, force=True)
        self.assertEqual(loader.sync_metadata(self.session)['sourceStatus'], 'unavailable')

    def test_delete_all_clears_only_infrastructure(self):
        self.seed()
        self.assertEqual(loader.delete_all(self.session)['events'], 5)
        self.assertEqual(loader.event_archive(self.session), {'events': []})


from test_auth import ApiTestCase


class GraphAccessTests(ApiTestCase):
    def test_unauthorized_cannot_read_graph_archive_or_loader(self):
        for path, method in [('/api/graph', 'GET'), ('/api/events/archive', 'GET'),
                             ('/api/infra-loader/events', 'GET'), ('/api/infra-loader/fetch-all', 'POST'),
                             ('/api/infra-loader/delete-all', 'POST')]:
            self.assertEqual(self.request(path, method=method)[0], 401)

    def test_regular_user_cannot_modify_cache(self):
        self.register('graph-reader@example.test')
        token = self.login('graph-reader@example.test')[1]['access_token']
        for path in ['/api/infra-loader/delete-all', '/api/infra-loader/fetch-all']:
            self.assertEqual(self.request(path, method='POST', token=token)[0], 403)
        self.assertEqual(self.request('/api/graph?at=2026-11-17T10:00:00', token=token)[0], 422)
