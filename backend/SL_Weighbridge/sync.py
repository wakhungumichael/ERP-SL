from SL_Sales.models import Product
from SL_Weighbridge.models import VehicleType


def vehicle_type_product_code(name: str) -> str:
    return f"WB-{name.upper().replace(' ', '-').replace('/', '-')}"[:50]


def sync_vehicle_type_product_for_tenant(vehicle_type, tenant):
    if tenant is None:
        return None

    defaults = {
        "name": f"Weighbridge Service - {vehicle_type.name}",
        "description": vehicle_type.description or f"Weighbridge service for {vehicle_type.name}",
        "product_type": "service",
        "unit": "weighing",
        "unit_price": vehicle_type.charge or 0,
        "tax_rate": 0,
        "is_active": True,
    }
    product, _ = Product.objects.update_or_create(
        tenant=tenant,
        code=vehicle_type_product_code(vehicle_type.name),
        defaults=defaults,
    )
    return product


def sync_vehicle_type_products_for_tenant(tenant):
    products = []
    if tenant is None:
        return products
    for vehicle_type in VehicleType.objects.all().order_by("name"):
        products.append(sync_vehicle_type_product_for_tenant(vehicle_type, tenant))
    return products
