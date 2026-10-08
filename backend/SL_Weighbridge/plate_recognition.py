import re
from dataclasses import dataclass

class PlateRecognitionUnavailable(RuntimeError):
    pass


@dataclass(frozen=True)
class PlateRecognitionResult:
    plate: str
    confidence: float


def normalize_plate(value: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", (value or "").upper())


def _plate_score(candidate: str, confidence: float) -> float:
    score = confidence
    if re.fullmatch(r"[A-Z]{3}[0-9]{3}[A-Z]", candidate):
        score += 80
    elif re.fullmatch(r"[A-Z]{2,3}[0-9]{2,4}[A-Z]{0,2}", candidate):
        score += 55
    elif re.fullmatch(r"[0-9]{1,3}[A-Z]{1,3}[0-9]{1,4}[A-Z]?", candidate):
        score += 35
    if candidate.startswith("K"):
        score += 15
    if 6 <= len(candidate) <= 8:
        score += 10
    return score


def _extract_candidates(text: str, confidence: float):
    compact = normalize_plate(text)
    values = {compact}
    values.update(normalize_plate(value) for value in re.findall(r"[A-Z0-9 -]{5,14}", text.upper()))
    return [
        (value, confidence)
        for value in values
        if 5 <= len(value) <= 10
        and any(character.isalpha() for character in value)
        and any(character.isdigit() for character in value)
    ]


def _ocr_candidates(image):
    try:
        import pytesseract
        from pytesseract import Output
    except ImportError as exc:
        raise PlateRecognitionUnavailable("Plate recognition dependencies are not installed on this server.") from exc

    try:
        data = pytesseract.image_to_data(
            image,
            config="--oem 3 --psm 7 -c tessedit_char_whitelist=ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
            output_type=Output.DICT,
        )
    except pytesseract.TesseractNotFoundError as exc:
        raise PlateRecognitionUnavailable("Plate recognition is not installed on this server.") from exc
    except pytesseract.TesseractError:
        return []

    words = []
    confidences = []
    candidates = []
    for raw_text, raw_confidence in zip(data.get("text", []), data.get("conf", [])):
        text = (raw_text or "").strip()
        if not text:
            continue
        try:
            confidence = max(float(raw_confidence), 0.0)
        except (TypeError, ValueError):
            confidence = 0.0
        words.append(text)
        confidences.append(confidence)
        candidates.extend(_extract_candidates(text, confidence))

    if words:
        average_confidence = sum(confidences) / max(len(confidences), 1)
        candidates.extend(_extract_candidates("".join(words), average_confidence))
    return candidates


def recognize_plate_image(image_bytes: bytes) -> PlateRecognitionResult | None:
    try:
        import cv2
        import numpy as np
    except ImportError as exc:
        raise PlateRecognitionUnavailable("Plate recognition dependencies are not installed on this server.") from exc

    image = cv2.imdecode(np.frombuffer(image_bytes, dtype=np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        return None

    height, width = image.shape[:2]
    if max(height, width) > 1800:
        scale = 1800 / max(height, width)
        image = cv2.resize(image, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)

    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    gray = cv2.bilateralFilter(gray, 9, 75, 75)
    threshold = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)[1]
    variants = [gray, threshold]

    edges = cv2.Canny(gray, 80, 200)
    contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    for contour in sorted(contours, key=cv2.contourArea, reverse=True)[:20]:
        x, y, box_width, box_height = cv2.boundingRect(contour)
        aspect_ratio = box_width / max(box_height, 1)
        if box_width < 100 or box_height < 20 or not 2.0 <= aspect_ratio <= 6.5:
            continue
        padding_x = max(int(box_width * 0.08), 4)
        padding_y = max(int(box_height * 0.18), 4)
        crop = gray[
            max(0, y - padding_y):min(gray.shape[0], y + box_height + padding_y),
            max(0, x - padding_x):min(gray.shape[1], x + box_width + padding_x),
        ]
        if crop.size:
            variants.append(cv2.resize(crop, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC))
        if len(variants) >= 7:
            break

    candidates = []
    for variant in variants:
        candidates.extend(_ocr_candidates(variant))
    if not candidates:
        return None

    plate, confidence = max(candidates, key=lambda item: _plate_score(*item))
    return PlateRecognitionResult(plate=plate, confidence=round(confidence, 1))
