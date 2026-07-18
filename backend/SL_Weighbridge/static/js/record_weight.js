document.getElementById('weightForm').addEventListener('submit', function(event) {
    event.preventDefault(); // Prevent default form submission

    const formData = new FormData(this);

    fetch('{% url "record_weight" %}', {
        method: 'POST',
        body: formData,
        headers: {
            'X-CSRFToken': document.querySelector('[name=csrfmiddlewaretoken]').value
        }
    })
    .then(response => response.json()) // Assuming the response is JSON
    .then(data => {
        console.log(data);
        // Handle successful response
        alert('Form submitted successfully!');
    })
    .catch(error => {
        console.error('Error:', error);
        // Handle errors
        alert('There was an error submitting the form.');
    });
});
