class ApiResponse {
  static success(res, data = null, message = 'OK', status = 200) {
    return res.status(status).json({
      success: true,
      message: message,
      data: data,
    });
  }

  static error(res, message, status = 400, errors = null) {
    const payload = {
      success: false,
      message: message,
    };

    if (errors !== null && errors !== undefined) {
      payload.errors = errors;
    }

    return res.status(status).json(payload);
  }
}

module.exports = ApiResponse;
