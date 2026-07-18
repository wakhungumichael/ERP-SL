document.addEventListener("DOMContentLoaded", function() {
    // Get the manual_weight_capture checkbox, gross_weight, tare_weight, weight_reason, and manual_receipt fields
    const manualWeightCheckbox = document.querySelector("#id_manual_weight_capture");
    const grossWeightField = document.querySelector(".field-gross_weight");
    const tareWeightField = document.querySelector(".field-tare_weight");
    const weightReasonField = document.querySelector(".field-weight_reason");
    const manualReceiptField = document.querySelector(".field-manual_receipt");
    const netweightField = document.querySelector(".field-net_weight");

    if (
        !manualWeightCheckbox ||
        !grossWeightField ||
        !tareWeightField ||
        !weightReasonField ||
        !manualReceiptField ||
        !netweightField
    ) {
        return;
    }


    // Define a function to toggle the visibility of the fields
    function toggleWeightFields() {
        const shouldShow = manualWeightCheckbox.checked; // Check if the checkbox is checked

        // Toggle visibility based on the checkbox state
        grossWeightField.style.display = shouldShow ? "block" : "none";
        tareWeightField.style.display = shouldShow ? "block" : "none";
        weightReasonField.style.display = shouldShow ? "block" : "none";
        manualReceiptField.style.display = shouldShow ? "block" : "none";
        netweightField.style.display = shouldShow ? "block" : "none";

    }

    // Run the toggle function on load and on checkbox change
    toggleWeightFields(); // Initial run
    manualWeightCheckbox.addEventListener("change", toggleWeightFields); // Event listener for changes
});
