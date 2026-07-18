(function($) {
    $(document).ready(function() {
        /**
         * SL Weighbridge — Live weight display (admin UI widget).
         *
         * Previously hardcoded to http://172.29.45.173:8083/… (local indicator IP).
         * Now routes through the platform API so the full indicator resolution
         * chain is respected: IndicatorConfig → IntegrationEndpoint → settings.
         *
         * The admin page is served from the same Django origin, so session
         * authentication covers the request automatically.
         */
        var LIVE_URL = '/api/commercial-weighbridge/live-weight/';

        function getCsrfToken() {
            var match = document.cookie.match(/csrftoken=([^;]+)/);
            return match ? match[1] : '';
        }

        function fetchWeight() {
            $.ajax({
                url: LIVE_URL,
                method: 'GET',
                headers: { 'X-CSRFToken': getCsrfToken() },
                success: function(data) {
                    var el = $('#real-time-weight');
                    if (data && data.weight !== null && data.weight !== undefined) {
                        el.text(Number(data.weight).toLocaleString() + ' kg');
                        el.removeClass('weight-offline').addClass(data.stable ? 'weight-stable' : 'weight-settling');
                    } else {
                        el.text('-- kg');
                        el.removeClass('weight-stable weight-settling').addClass('weight-offline');
                    }
                },
                error: function() {
                    var el = $('#real-time-weight');
                    el.text('-- kg');
                    el.removeClass('weight-stable weight-settling').addClass('weight-offline');
                }
            });
        }

        // Initial read + poll every 2 s
        fetchWeight();
        setInterval(fetchWeight, 2000);
    });
})(django.jQuery);
