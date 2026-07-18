function onVehiclePlateChange(vehiclePlate) {
    fetch(`/SL_weighbridge/api/transactions/?vehicle_plate=${encodeURIComponent(vehiclePlate)}&ordering=-created_at&limit=1`)
      .then(response => response.json())
      .then(data => {
        if(data.length === 0) return;
  
        const lastTransaction = data[0];
        // Populate these fields
        document.querySelector('#id_operator').value = lastTransaction.operator;
        document.querySelector('#id_item_name').value = lastTransaction.item_name;
        document.querySelector('#id_vehicle_type_name').value = lastTransaction.vehicle_type_name;
        document.querySelector('#id_customer_name').value = lastTransaction.customer_name;
        document.querySelector('#id_destination').value = lastTransaction.destination;
        document.querySelector('#id_payment_mode').value = lastTransaction.payment_mode;
  
        // Check weight_type selected by user
        const weightType = document.querySelector('#id_weight_type').value;
  
        if(weightType === 'Second Weight') {
          // Fetch first weight to populate gross weight fields
          fetch(`/SL_weighbridge/api/transactions/?vehicle_plate=${encodeURIComponent(vehiclePlate)}&weight_type=First Weight&ordering=-created_at&limit=1`)
            .then(resp => resp.json())
            .then(firstWeightData => {
              if(firstWeightData.length === 0) return;
  
              const firstWeight = firstWeightData[0];
              document.querySelector('#id_gross_weight').value = firstWeight.gross_weight;
              document.querySelector('#id_gross_weight_date').value = firstWeight.gross_weight_date;
            });
        } else {
          // Clear gross weight fields for first weight
          document.querySelector('#id_gross_weight').value = '';
          document.querySelector('#id_gross_weight_date').value = '';
        }
      });
  }
  
  // Add event listener to vehicle plate select
  document.querySelector('#id_vehicle_plate').addEventListener('change', e => {
    onVehiclePlateChange(e.target.value);
  });
  
  // Add event listener to weight_type select to re-trigger population if weight_type changes
  document.querySelector('#id_weight_type').addEventListener('change', e => {
    const vehiclePlate = document.querySelector('#id_vehicle_plate').value;
    if(vehiclePlate) onVehiclePlateChange(vehiclePlate);
  });
    