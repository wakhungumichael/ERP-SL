# Author: Michael Wakhungu
# Company: Siakora Labs Limited

from django.core.management.base import BaseCommand
from ...models import CameraConfig, VehiclePresence
from ...utils import save_image_from_camera
import time
import logging
import requests

class Command(BaseCommand):
    help = 'Monitor vehicle presence on the weighbridge and capture details.'

    def handle(self, *args, **kwargs):
        logger = logging.getLogger(__name__)

        # ✅ Updated API endpoint
        weight_api_url = "http://172.29.45.173:5000/weight"

        while True:
            camera_config = CameraConfig.objects.first()
            if camera_config:
                self.stdout.write(self.style.SUCCESS(f"Using camera configuration: {camera_config}"))

            try:
                response = requests.get(weight_api_url, timeout=5)
                response.raise_for_status()

                data = response.json()
                weight_str = data.get("weight")

                if not weight_str or not weight_str.isdigit():
                    self.stdout.write(self.style.WARNING("Weight not detected or not yet stable."))
                    continue

                weight = int(weight_str)
                if weight > -1:  # Threshold logic
                    plate_number = None
                    image = None

                    if camera_config and camera_config.connection_type == 'IP':
                        try:
                            print("Plate detection channel not yet implemented. Skipping plate detection.")
                            image = save_image_from_camera(
                                camera_config.ip_address,
                                camera_config.username,
                                camera_config.password
                            )
                        except requests.exceptions.HTTPError as e:
                            logger.error(f"HTTPError while fetching image: {e}")
                            if e.response is not None:
                                logger.error(f"Response: {e.response.text}")
                        except Exception as e:
                            logger.error(f"Unexpected error capturing image: {e}")

                    VehiclePresence.objects.create(
                        detected_weight=weight,
                        capture_status=bool(plate_number),
                        plate_number=plate_number,
                        image=image
                    )

                    self.stdout.write(self.style.SUCCESS(f"Captured vehicle presence at weight: {weight} kg"))
                else:
                    self.stdout.write(self.style.WARNING("Weight is below threshold, skipping capture."))

            except requests.RequestException as e:
                logger.error(f"Error calling weight API: {e}")
                self.stdout.write(self.style.ERROR(f"Failed to call weight API: {e}"))

            time.sleep(10)  # Wait before next check
