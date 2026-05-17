console.log("NEW VERSION");
exports.handler = async (event) => {
  try {
    const { clientEmail, quoteNumber, total } = JSON.parse(event.body);

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "ALUM(cm) <noreply@alum-cm.co.il>",
        to: clientEmail,
        subject: `הצעת מחיר #${quoteNumber}`,
        html: `
          <div style="font-family:Arial;padding:20px">
            <h2>הצעת מחיר חדשה</h2>

            <p>מספר הצעה: <strong>${quoteNumber}</strong></p>
            <p>סה״כ: <strong>${total} ₪</strong></p>

            <p>נשלח ממערכת ALUM(cm)</p>
          </div>
        `,
      }),
    });

    const data = await response.json();
console.log(data);
    return {
      statusCode: 200,
      body: JSON.stringify(data),
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: error.message,
      }),
    };
  }
};
