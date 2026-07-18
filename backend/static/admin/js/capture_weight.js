document.addEventListener("DOMContentLoaded", function () {
    const buttons = document.querySelectorAll(".capture-weight-button");

    if (!buttons.length) {
        return;
    }

    function setFieldValue(id, value) {
        const field = document.getElementById(id);
        if (field) {
            field.value = value;
        }
    }

    function getFieldValue(id) {
        const field = document.getElementById(id);
        return field ? field.value : "";
    }

    function getTimestamp() {
        return new Date().toISOString().slice(0, 19);
    }

    buttons.forEach(function (button) {
        button.addEventListener("click", function () {
            fetch("/SL_weighbridge/api/get_weight/")
                .then(function (response) {
                    if (!response.ok) {
                        throw new Error("Failed to fetch weight.");
                    }
                    return response.json();
                })
                .then(function (data) {
                    const weight = data.weight;
                    const weightType = getFieldValue("id_weight_type");

                    if (weight === undefined || weight === null) {
                        throw new Error("No weight returned.");
                    }

                    if (weightType === "Second Weight") {
                        setFieldValue("id_tare_weight", weight);
                        setFieldValue("id_tare_weight_date", getTimestamp());

                        const grossWeight = parseFloat(getFieldValue("id_gross_weight"));
                        if (!Number.isNaN(grossWeight)) {
                            setFieldValue("id_net_weight", Math.abs(grossWeight - parseFloat(weight)));
                        }
                    } else {
                        setFieldValue("id_gross_weight", weight);
                        setFieldValue("id_gross_weight_date", getTimestamp());
                        setFieldValue("id_tare_weight", 0);
                        setFieldValue("id_net_weight", 0);
                    }
                })
                .catch(function (error) {
                    console.error("Error fetching weight:", error);
                });
        });
    });
});
