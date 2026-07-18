// custom_script.js
document.addEventListener('DOMContentLoaded', function() {
    const resizableColumns = document.querySelectorAll('th.resizable');

    resizableColumns.forEach(function(column) {
        let startX, startWidth;

        column.addEventListener('mousedown', function(e) {
            startX = e.clientX;
            startWidth = column.offsetWidth;

            const doDrag = (e) => {
                column.style.width = startWidth + (e.clientX - startX) + 'px';
            };

            const stopDrag = () => {
                document.removeEventListener('mousemove', doDrag);
                document.removeEventListener('mouseup', stopDrag);
            };

            document.addEventListener('mousemove', doDrag);
            document.addEventListener('mouseup', stopDrag);
        });
    });
});
