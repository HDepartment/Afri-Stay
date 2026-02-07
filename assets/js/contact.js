document.getElementById('contactForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const name = document.getElementById('contactName').value;
    const email = document.getElementById('contactEmail').value;
    const message = document.getElementById('contactMessage').value;

    try {
        // Send directly to Supabase Table 'messages'
        const { error } = await supabase
            .from('messages')
            .insert([{ full_name: name, email: email, message: message }]);

        if (error) throw error;

        alert("Message sent! We will contact you shortly.");
        e.target.reset(); // Clear form

    } catch (error) {
        console.error(error);
        alert("Error sending message: " + error.message);
    }
});