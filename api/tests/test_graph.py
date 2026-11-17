from test_auth import ApiTestCase


class GraphTests(ApiTestCase):
    def test_authenticated_readonly_graph_contract_and_acyclicity(self):
        self.assertEqual(self.request('/api/graph')[0], 401)
        token = self.login('admin1', '12345678')[1]['access_token']
        status, graph, _ = self.request('/api/graph', token=token)
        self.assertEqual(status, 200)
        self.assertTrue(graph['demo'])
        objects = {item['id']: item for item in graph['objects']}
        self.assertEqual(len(objects), 120)
        self.assertEqual(len({item['district'] for item in objects.values()}), 3)
        self.assertEqual({state for item in objects.values() for state in item['states'].values()}, {'normal', 'maintenance', 'incident'})
        adjacency = {key: [] for key in objects}
        indegree = {key: 0 for key in objects}
        edge_ids = set()
        for edge in graph['dependencies']:
            self.assertNotIn(edge['id'], edge_ids)
            edge_ids.add(edge['id'])
            self.assertIn(edge['source'], objects)
            self.assertIn(edge['target'], objects)
            self.assertIn(edge['resource'], objects[edge['source']]['resources'])
            self.assertIn(edge['resource'], objects[edge['target']]['resources'])
            adjacency[edge['source']].append(edge['target'])
            indegree[edge['target']] += 1
        queue = [key for key, degree in indegree.items() if not degree]
        for key in queue:
            for target in adjacency[key]:
                indegree[target] -= 1
                if not indegree[target]:
                    queue.append(target)
        self.assertEqual(len(queue), len(objects), 'Demo graph must be a DAG')
        for method in ['POST', 'PUT', 'PATCH', 'DELETE']:
            self.assertEqual(self.request('/api/graph', {}, token=token, method=method)[0], 405)
        self.assertEqual(self.request('/api/graph', token=token)[1], graph)

    def test_regular_account_can_read_graph(self):
        self.request('/api/auth/register', {'email': 'graph-reader@example.test', 'password': 'test-password'})
        token = self.login('graph-reader@example.test')[1]['access_token']
        self.assertEqual(self.request('/api/graph', token=token)[0], 200)
