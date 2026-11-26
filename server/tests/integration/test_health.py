def test_health_runs_select_1(app_client):
    r = app_client.get("/api/v1/health")
    assert r.status_code == 200
    assert r.json() == {"ok": True}
