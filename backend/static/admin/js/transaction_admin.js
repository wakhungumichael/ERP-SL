(function($) {
    $(document).ready(function() {
        $('#id_vehicle').change(function() {
            var vehicleId = $(this).val();
            if (vehicleId) {
                $.ajax({
                    url: 'SL_weighbridge/fetch-transaction-details/',
                    data: { 'vehicle_id': vehicleId },
                    dataType: 'json',
                    success: function(data) {
                        if (data.customer_id) {
                            $('#id_customer').val(data.customer_id).change();
                        } else {
                            $('#id_customer').val('');
                        }
                        if (data.item_id) {
                            $('#id_item').val(data.item_id).change();
                        } else {
                            $('#id_item').val('');
                        }
                        if (data.operator) {
                            $('#id_operator').val(data.operator);
                        } else {
                            $('#id_operator').val('');
                        }
                        if (data.vehicle_type_id) {
                            $('#id_vehicle_type').val(data.vehicle_type_id).change();
                        } else {
                            $('#id_vehicle_type').val('');
                        }
                        if (data.created_by) {
                            $('#id_created_by').text(data.created_by);
                        } else {
                            $('#id_created_by').text('');
                        }
                    }
                });
            } else {
                // Clear the fields if no vehicle is selected
                $('#id_customer, #id_item, #id_operator, #id_vehicle_type').val('');
                $('#id_created_by').text('');
            }
        });
    });
})(django.jQuery);
