let isSignUp = false;

function toggleAuth(mode) {
    const title = document.querySelector('.form-title');
    const submitBtn = document.getElementById('submitBtn');
    const nameField = document.getElementById('nameField');
    const btnSignin = document.getElementById('btn-signin');
    const btnSignup = document.getElementById('btn-signup');
    const whiteText = document.querySelector('.box-left .title-group');
    const whiteText1 = whiteText.children[0];
    const whiteText2 = whiteText.children[1];

    // Clear errors
    document.getElementById('authError').style.display = 'none';

    if (mode === 'signup') {
        isSignUp = true;
        title.innerText = "Create Account";
        submitBtn.innerText = "Sign Up";
        nameField.classList.remove('hidden'); 
        btnSignup.classList.add('active');
        btnSignin.classList.remove('active');
        whiteText1.innerText = " Join Us!";
        whiteText2.innerText = "";
    } else {
        isSignUp = false;
        title.innerText = "Sign In";
        submitBtn.innerText = "Login";
        nameField.classList.add('hidden');
        btnSignin.classList.add('active');
        btnSignup.classList.remove('active');
        whiteText1.innerText = "Welcome";
        whiteText2.innerText = "Back!";

    }
}

document.getElementById('authForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const fullName = document.getElementById('fullName').value;
    const errorMsg = document.getElementById('authError');
    const successMsg = document.getElementById('authSuccess');

    errorMsg.style.display = 'none';

    try {
        if (isSignUp) {
            // 1. Get the new Phone Number value
            const phone = document.getElementById('phoneNumber').value;

            // 2. Sign Up (Send Name AND Phone in 'options')
            const { data, error } = await supabaseClient.auth.signUp({
                email: email,
                password: password,
                options: {
                    data: {
                        full_name: fullName, // <--- Suitcase Item 1
                        phone_number: phone  // <--- Suitcase Item 2
                    }
                }
            });

            if (error) throw error;

            // 3. Success (No manual insert code here at all!)
            successMsg.innerText = "Account created! Please check your email.";
            successMsg.style.display = 'block';

        }   else {
            // Sign In
            const { error } = await supabaseClient.auth.signInWithPassword({
                email, password
            });
            if (error) throw error;
            window.location.href = "admin.html"; // Go home
        }
    } catch (err) {
        errorMsg.innerText = err.message;
        errorMsg.style.display = 'block';
    }
});