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
          error: "כתובת מייל לא תקינה"
        })
      };
    }

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: "ALUM(cm) <quotes@alum-cm.co.il>",
        to,
        subject: `הצעת מחיר ${quoteNumber}`,
        html: `
          <div dir="rtl" style="font-family:Arial;padding:24px">
            <h2>שלום ${clientName}</h2>

            <p>מצורפת הצעת המחיר שלך.</p>

            <p>
              <strong>מספר הצעה:</strong>
              ${quoteNumber}
            </p>

            <p>
              <strong>סה״כ:</strong>
              ₪${total}
            </p>

            <br>

            <a href="${quoteUrl}"
               style="
                 background:#0a1628;
                 color:white;
                 padding:14px 22px;
                 border-radius:10px;
                 text-decoration:none;
                 display:inline-block;
                 font-weight:bold;
               ">
               לצפייה בהצעה
            </a>

            <br><br>

            <div style="font-size:13px;color:#666">
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
