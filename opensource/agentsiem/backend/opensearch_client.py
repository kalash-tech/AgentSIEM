from __future__ import annotations

import os
from typing import Any, Dict, List
from opensearchpy import OpenSearch

TELEMETRY_INDEX = os.getenv("OPENSEARCH_TELEMETRY_INDEX", "agentsiem-telemetry")
INCIDENTS_INDEX = os.getenv("OPENSEARCH_INCIDENTS_INDEX", "agentsiem-incidents")


def get_opensearch_client() -> OpenSearch:
    url = os.getenv("OPENSEARCH_URL", "http://localhost:9200")
    return OpenSearch(hosts=[url], use_ssl=url.startswith("https://"), verify_certs=False)


def ensure_indices(client: OpenSearch) -> None:
    if not client.indices.exists(index=TELEMETRY_INDEX):
        client.indices.create(
            index=TELEMETRY_INDEX,
            body={
                "settings": {"index": {"knn": True}},
                "mappings": {
                    "properties": {
                        "trace_id": {"type": "keyword"},
                        "agent": {"type": "keyword"},
                        "step": {"type": "integer"},
                        "event_type": {"type": "keyword"},
                        "action": {"type": "keyword"},
                        "tool_name": {"type": "keyword"},
                        "target": {"type": "text", "fields": {"keyword": {"type": "keyword"}}},
                        "content": {"type": "text"},
                        "timestamp": {"type": "date"},
                    }
                },
            },
        )

    if not client.indices.exists(index=INCIDENTS_INDEX):
        client.indices.create(
            index=INCIDENTS_INDEX,
            body={
                "mappings": {
                    "properties": {
                        "trace_id": {"type": "keyword"},
                        "risk_score": {"type": "integer"},
                        "reasons": {"type": "text"},
                        "forensic_report": {"type": "object"},
                        "created_at": {"type": "date"},
                    }
                }
            },
        )


def index_telemetry_event(client: OpenSearch, event: Dict[str, Any]) -> str:
    res = client.index(index=TELEMETRY_INDEX, body=event, refresh="wait_for")
    return str(res.get("_id", ""))


def get_trace_timeline(client: OpenSearch, trace_id: str) -> List[Dict[str, Any]]:
    res = client.search(
        index=TELEMETRY_INDEX,
        body={
            "size": 100,
            "query": {"term": {"trace_id": trace_id}},
            "sort": [{"step": {"order": "asc"}}],
        },
    )
    return [hit["_source"] for hit in res.get("hits", {}).get("hits", [])]


def index_incident_report(client: OpenSearch, incident: Dict[str, Any]) -> str:
    res = client.index(
        index=INCIDENTS_INDEX,
        id=incident["trace_id"],
        body=incident,
        refresh="wait_for",
    )
    return str(res.get("_id", ""))


def list_incidents(client: OpenSearch, limit: int = 50) -> List[Dict[str, Any]]:
    if not client.indices.exists(index=INCIDENTS_INDEX):
        return []
    res = client.search(
        index=INCIDENTS_INDEX,
        body={"size": limit, "sort": [{"created_at": {"order": "desc"}}]},
    )
    return [hit["_source"] for hit in res.get("hits", {}).get("hits", [])]
