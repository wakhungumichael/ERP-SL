document.addEventListener('DOMContentLoaded', function() {
    const customerSelect = document.getElementById('id_customer');
    const vehicleSelect = document.getElementById('id_vehicle');

    if (customerSelect) {
        customerSelect.addEventListener('change', function() {
            const customerId = customerSelect.value;

            if (customerId) {
                fetch(`/admin/SL_Weighbridge/vehicles-for-customer/?customer_id=${customerId}`)
                    .then(response => response.json())
                    .then(data => {
                        vehicleSelect.innerHTML = '';
                        data.vehicles.forEach(vehicle => {
                            const option = document.createElement('option');
                            option.value = vehicle.id;
                            option.textContent = vehicle.number_plate;
                            vehicleSelect.appendChild(option);
                        });
                    });
            } else {
                vehicleSelect.innerHTML = '<option value="">---------</option>';
            }
        });
    }
});

console.log("admin_custom.js loaded");
