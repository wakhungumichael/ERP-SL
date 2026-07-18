#Author: Michael Wakungu
#Company: Siakora Labs Limited

import os
import time
import serial
import requests
import re
import logging
from datetime import datetime
from django.utils import timezone
from .models import PrinterConfig, IndicatorConfig, VehiclePresence, Transaction
from .management.commands.printer_commands import get_printer_command
from requests.auth import HTTPDigestAuth
from django.conf import settings
from contextlib import contextmanager
import tempfile

import serial
import time
import os
import tempfile
from contextlib import contextmanager
import logging

import serial
import logging
import time
import re

import serial
import logging
import re
import time
from urllib.parse import urljoin

import serial
import logging
import re
import time


# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s"
)


def get_indicator_stable_weight_url():
    return getattr(settings, "INDICATOR_STABLE_WEIGHT_URL", "")


def get_indicator_live_weight_url():
    return getattr(settings, "INDICATOR_LIVE_WEIGHT_URL", "")


def get_indicator_live_weight_stream_url():
    return getattr(settings, "INDICATOR_LIVE_WEIGHT_STREAM_URL", "")


def get_indicator_api_url(path):
    base_url = getattr(settings, "INDICATOR_API_BASE_URL", "")
    if not base_url:
        return path
    return urljoin(f"{base_url.rstrip('/')}/", path.lstrip('/'))


def parse_indicator_response(response):
    content_type = response.headers.get("Content-Type", "")

    try:
        return response.json()
    except ValueError:
        body_preview = response.text.strip().replace("\n", " ")[:200]
        raise ValueError(
            f"Indicator API returned non-JSON content "
            f"(status {response.status_code}, content-type: {content_type or 'unknown'}). "
            f"Response preview: {body_preview or '[empty response]'}"
        )


def setup_serial_connection(config):
    """Set up the serial connection using the configuration."""
    try:
        ser = serial.Serial(
            port=config.port,  # COM5, for example
            baudrate=config.baud_rate,  # Your baud rate
            bytesize=config.data_bits,
            parity=serial.PARITY_NONE,
            stopbits=config.stop_bits,
            timeout=2  # Increased timeout to 2 seconds
        )
        logging.info(f"Serial port {config.port} opened successfully!")
        return ser
    except serial.SerialException as e:
        logging.error(f"Failed to open serial port: {e}")
        raise e

def is_weight_settled(weight_history, threshold=0.5):
    """Determine if the weight is settled based on historical values."""
    if len(weight_history) < 2:
        return False  
    return max(weight_history) - min(weight_history) < threshold




def stream_weight_from_indicator(indicator_config, duration=10):
    """
    Stream weight readings continuously for 'duration' seconds.
    Returns a generator that yields the current weight.
    """
    try:
        ser = setup_serial_connection(indicator_config)
        start_time = time.time()

        while time.time() - start_time < duration:
            raw_data = ser.read(10).decode(errors='replace').strip()
            if raw_data:
                weight = parse_weight_data(raw_data)
                if weight is not None:
                    yield weight
        ser.close()

    except Exception as e:
        logging.error(f"Error streaming weight: {e}")
        yield None



def capture_weight_from_indicator(indicator_config, retries=3):
    """Capture weight data from the indicator."""
    attempt = 0
    while attempt < retries:
        try:
            # Open the serial connection
            ser = setup_serial_connection(indicator_config)

            # Buffer to hold received data and historical weights
            received_data = ""
            weight_history = []
            start_time = time.time()

            while time.time() - start_time < 5:  # Read for 5 seconds
                raw_data = ser.read(10).decode(errors='replace').strip()  # Read in chunks
                if raw_data:
                    received_data += raw_data
                    logging.info(f"Raw data received: {raw_data}")

                    # Parse the weight and add it to the history
                    weight = parse_weight_data(raw_data)
                    if weight is not None:
                        weight_history.append(weight)
                        # Check if the weight is settled
                        if is_weight_settled(weight_history):
                            logging.info(f"Settled weight detected: {weight}")
                            ser.close()  # Close the serial connection
                            return weight  # Return the settled weight

            # Close the serial connection after reading
            ser.close()

            logging.warning("No settled weight detected.")
        except serial.SerialException as e:
            logging.error(f"Serial communication error (Attempt {attempt + 1}/{retries}): {e}")
        except Exception as e:
            logging.error(f"Unexpected error: {e}")
        finally:
            attempt += 1
            time.sleep(1)  # Delay before retrying

    logging.error(f"Failed to capture settled weight after {retries} attempts.")
    return None

def parse_weight_data(raw_data):
    """Extract and parse the weight from the raw data."""
    match = re.search(r'[-+]?\d+', raw_data)
    if match:
        return int(match.group())
    else:
        logging.warning(f"No valid weight found in data: {raw_data}")
        return None
    


def capture_real_time_weight_from_indicator(indicator_config, read_timeout=1):
    """
    Capture a quick snapshot of weight from the indicator without waiting for it to settle.
    """
    try:
        ser = setup_serial_connection(indicator_config)
        ser.timeout = read_timeout  # Set a shorter timeout for quick read

        raw_data = ser.read(10).decode(errors='replace').strip()
        ser.close()

        weight = parse_weight_data(raw_data)
        return weight

    except serial.SerialException as e:
        logging.error(f"Serial port error in real-time capture: {e}")
        return None
    except Exception as e:
        logging.error(f"Unexpected error in real-time capture: {e}")
        return None





def check_no_motion_state(raw_data):
    """Check if the indicator is in a no-motion state."""
    # Adjust this according to how your indicator reports stability
    return "NO-MOTION" in raw_data or raw_data.startswith("STABLE")


def get_active_printer():
    """Returns the active printer from the PrinterConfig table."""
    return PrinterConfig.objects.filter(is_active=True).first()

def print_receipt(command):
    """Send print command to the active printer."""
    printer_config = get_active_printer()

    if not printer_config:
        print("Error: No active printer found.")
        return

    try:
        with setup_serial_connection(printer_config) as ser:
            ser.write(command.encode())
    except Exception as e:
        print(f"Error printing receipt: {e}")




#Camera


def save_image_from_camera(ip_address, username, password):
    url = f'http://{ip_address}:8181/ISAPI/Streaming/channels/02/picture'
        #url = f'http://{ip_address}:8181/ISAPI/Streaming/channels/01/picture'
    try:
        response = requests.get(url, auth=HTTPDigestAuth(username, password), stream=True, timeout=10)
        response.raise_for_status()

        # Use MEDIA_ROOT to construct the path
        image_dir = os.path.join(settings.MEDIA_ROOT, "vehicle_images")
        os.makedirs(image_dir, exist_ok=True)

        image_path = os.path.join(image_dir, f"{datetime.now().strftime('%Y%m%d%H%M%S')}.jpg")
        with open(image_path, 'wb') as img_file:
            for chunk in response.iter_content(chunk_size=8192):
                img_file.write(chunk)

        print(f"Image saved to {image_path}")
        return os.path.relpath(image_path, settings.MEDIA_ROOT)  # Return the relative path
    except requests.exceptions.HTTPError as http_err:
        if response.status_code == 401:
            print(f"Unauthorized access - Check your credentials for {url}. Response: {response.text}")
        else:
            print(f"HTTP error occurred: {http_err} - Status code: {response.status_code}")
    except requests.RequestException as e:
        print(f"Error saving image from camera: {e}")
    return None





def get_plate_from_camera(ip_address, username, password):
    # Check if the plate detection channel is available
    print("Plate detection channel not yet implemented. Skipping plate detection.")
    return None  # Skip plate detection


def capture_vehicle_presence(ip_address, username, password, detected_weight):
    # Attempt to capture the plate number (skipped in this case)
    plate_number = get_plate_from_camera(ip_address, username, password)

    # Save the image from the camera
    image_path = save_image_from_camera(ip_address, username, password)

    # Create a VehiclePresence record
    vehicle_presence = VehiclePresence(
        detected_weight=detected_weight,
        capture_status=True,
        plate_number=plate_number,  # This will be None since we're skipping plate detection
        image=image_path  # Assign image path directly to the model field
    )

    # Save the record to the database
    vehicle_presence.save()

    print(f"Vehicle presence recorded: {vehicle_presence}")



from django.utils import timezone
from datetime import timedelta
import requests

def capture_weight_for_transaction(transaction):
    """
    Capture stable weight for a transaction from Indicator API
    """
    api_url = get_indicator_stable_weight_url()

    try:
        response = requests.get(api_url, timeout=5)

        if response.status_code != 200:
            return f"Unexpected response: {response.status_code} - {response.text}"

        data = parse_indicator_response(response)

        # ✅ Extract new API fields
        value = data.get("value")
        stable = data.get("stable")

        if value is None:
            return "Weight value not returned by indicator."

        if not stable:
            return "Weight not yet stable. Please wait."

        # Convert float → int (kg)
        weight = int(round(float(value)))

        # ✅ Business rule: minimum weight
        if weight < 1:
            return f"Weight too low ({weight} kg). Not captured."

        # ============================
        # Transaction handling
        # ============================
        if transaction.weight_type == "First Weight":
            transaction.gross_weight = weight
            transaction.gross_weight_date = timezone.now()
            transaction.net_weight = 0
            transaction.save()

            return (
                f"Captured FIRST weight: {weight} kg "
                f"for transaction {transaction.id}"
            )

        elif transaction.weight_type == "Second Weight":
            if not transaction.gross_weight:
                return "Gross weight not captured yet."

            transaction.tare_weight = weight
            transaction.tare_weight_date = timezone.now()
            transaction.net_weight = abs(
                transaction.gross_weight - transaction.tare_weight
            )
            transaction.charge = 0.00
            transaction.save()

            return (
                f"Captured SECOND weight: {weight} kg | "
                f"Net weight: {transaction.net_weight} kg"
            )

        return "Invalid weight type."

    except ValueError as e:
        return f"Error parsing indicator API response: {str(e)}"
    except requests.RequestException as e:
        return f"Error communicating with indicator API: {str(e)}"











def apply_common_filters(queryset, request):
    if request.GET.get('from'):
        queryset = queryset.filter(created_at__gte=request.GET.get('from'))
    if request.GET.get('to'):
        queryset = queryset.filter(created_at__lte=request.GET.get('to'))
    if request.GET.get('teller'):
        queryset = queryset.filter(created_by_id=request.GET.get('teller'))
    if request.GET.get('branch'):
        queryset = queryset.filter(branch_id=request.GET.get('branch'))
    if request.GET.get('item'):
        queryset = queryset.filter(item_id=request.GET.get('item'))
    if request.GET.get('vehicle'):
        queryset = queryset.filter(vehicle_id=request.GET.get('vehicle'))
    if request.GET.get('customer'):
        queryset = queryset.filter(customer_id=request.GET.get('customer'))
    if request.GET.get('weight_type'):
        queryset = queryset.filter(weight_type=request.GET.get('weight_type'))
    if request.GET.get('status'):
        queryset = queryset.filter(status=request.GET.get('status'))
    if request.GET.get('payment_mode'):
        queryset = queryset.filter(payment_mode=request.GET.get('payment_mode'))
    if request.GET.get('payment_status'):
        queryset = queryset.filter(payment_status=request.GET.get('payment_status'))

    return queryset


# SL_Weighbridge/utils.py

from django.template.loader import render_to_string
try:
    from weasyprint import HTML as WeasyHTML
except ImportError:
    WeasyHTML = None
import tempfile

def generate_invoice_pdf(invoice):
    html_string = render_to_string('invoice_template.html', {'invoice': invoice})
    result_file = tempfile.NamedTemporaryFile(delete=True, suffix='.pdf')
    if WeasyHTML is None:
        raise RuntimeError("weasyprint is not installed; PDF generation is unavailable.")
    WeasyHTML(string=html_string).write_pdf(result_file.name)
    return result_file
