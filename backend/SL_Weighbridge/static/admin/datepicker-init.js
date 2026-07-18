document.addEventListener("DOMContentLoaded", function () {
    const $ = window.django && window.django.jQuery ? window.django.jQuery : window.jQuery;

    if (!$) {
        return;
    }

    if ($.fn.datepicker) {
        $(".input-group.date").datepicker({
            format: "yyyy-mm-dd",
            todayBtn: "linked",
            clearBtn: true,
            autoclose: true,
        });
    }

    if ($.fn.datetimepicker) {
        $(".datetime-picker").datetimepicker({
            format: "YYYY-MM-DD HH:mm",
            showClear: true,
        });
    }
});
