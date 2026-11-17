"""Read-only demo contract. Replace demo_graph with a synchronized data query later."""
from typing import Annotated, Literal
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from modules.users.dependencies import get_current_user
from modules.users.models import User

router = APIRouter(prefix="/graph", tags=["graph"])
Resource = Literal["water", "energy"]
State = Literal["normal", "maintenance", "incident"]


class InfrastructureObject(BaseModel):
    id: str
    name: str
    kind: Literal["station", "consumer"]
    resources: list[Resource]
    states: dict[Resource, State]
    district: str
    address: str
    description: str


class Dependency(BaseModel):
    id: str
    source: str
    target: str
    resource: Resource


class GraphData(BaseModel):
    revision: str
    demo: bool
    objects: list[InfrastructureObject]
    dependencies: list[Dependency]


def demo_graph() -> GraphData:
    objects, dependencies = [], []
    for district_index, district in enumerate(["Центральный", "Северный", "Южный"]):
        for level in range(4):
            for lane in range(10):
                object_id = f"d{district_index}-l{level}-n{lane}"
                resource: Resource = "water" if lane < 5 else "energy"
                resources: list[Resource] = ["water", "energy"] if lane in (0, 5) else [resource]
                serial = district_index * 40 + level * 10 + lane
                states: dict[Resource, State] = {
                    r: "incident" if (serial + i) % 17 == 0 else
                    "maintenance" if (serial + i) % 13 == 0 else "normal"
                    for i, r in enumerate(resources)
                }
                label = ("Водозабор" if resource == "water" else "Подстанция") if level == 0 else (
                    "Насосная" if resource == "water" else "Распределитель") if level == 1 else (
                    "Тепловой пункт" if level == 2 else "Жилой дом")
                objects.append(InfrastructureObject(
                    id=object_id, name=f"{label} {district_index + 1}.{lane + 1}",
                    kind="consumer" if level == 3 else "station", resources=resources,
                    states=states, district=district,
                    address=f"{district} район, ул. Мира, {level * 10 + lane + 1}",
                    description="Демонстрационный объект инфраструктуры. Состояния и зависимости поступают с сервера.",
                ))
                if level:
                    dependencies.append(Dependency(id=f"e-{object_id}",
                        source=f"d{district_index}-l{level - 1}-n{lane}", target=object_id, resource=resource))
                    if lane % 5 < 4:
                        dependencies.append(Dependency(id=f"cross-{object_id}",
                            source=f"d{district_index}-l{level - 1}-n{lane + 1}", target=object_id, resource=resource))
    return GraphData(revision="demo-v1", demo=True, objects=objects, dependencies=dependencies)


@router.get("", response_model=GraphData)
def read_graph(user: Annotated[User, Depends(get_current_user)]):
    return demo_graph()
