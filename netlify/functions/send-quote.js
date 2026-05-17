exports.handler = async (event) => {
  try {
    const body = JSON.parse(event.body);

    const {
      to,
      clientName,
      quoteNumber,
      total,
      quoteUrl
    } = body;

    if (!to || !to.includes("@")) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: "אימייל לא תקין"
        })
      };
    }

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: "ALUM(cm) <onboarding@resend.dev>",
        to,
        subject: `הצעת מחיר מספר ${quoteNumber}`,
        html: `
          <div style="font-family:Arial;padding:20px">
            <h2>שלום ${clientName}</h2>

            <p>
              מצורפת הצעת המחיר שלך ממערכת ALUM(cm)
            </p>

            <div style="
              background:#f5f5f5;
              padding:15px;
              border-radius:10px;
              margin:20px 0;
            ">
              <p><strong>מספר הצעה:</strong> ${quoteNumber}</p>
              <p><strong>סה״כ:</strong> ₪${total}</p>
            </div>

            <a href="${quoteUrl}"
              style="
                display:inline-block;
                background:#0f766e;
                color:white;
                padding:14px 24px;
                border-radius:8px;
                text-decoration:none;
                font-weight:bold;
              ">
              לצפייה בהצעה
            </a>

            <br><br>

            <div style="font-size:12px;color:#666">
              ALUM(cm)
            </div>
          </div>
        `
      })
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        statusCode: 500,
        body: JSON.stringify(data)
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        data
      })
    };

  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: error.message
      })
    };
  }
};
