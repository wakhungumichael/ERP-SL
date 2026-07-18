document.addEventListener('DOMContentLoaded', function() {
    document.getElementById('id_customer').addEventListener('change', function() {
        var customerId = this.value;
        var xhr = new XMLHttpRequest();
        xhr.open('GET', '/get_vehicles/?customer=' + customerId, true);
        xhr.onload = function() {
            if (xhr.status === 200) {
                var vehicles = JSON.parse(xhr.responseText);
                var vehicleSelect = document.getElementById('id_vehicle');
                vehicleSelect.innerHTML = '';
                vehicles.forEach(function(vehicle) {
                    var option = document.createElement('option');
                    option.value = vehicle.id;
                    option.textContent = vehicle.number_plate;
                    vehicleSelect.appendChild(option);
                });
            }
        };
        xhr.send();
    });
});
